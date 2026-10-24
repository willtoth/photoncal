// Model-aware mean-pcam propagation, matching the pinned mrcal
// mrcal/model_analysis.py::_dq_db__projection_uncertainty. distance=0 means infinity.
// Spline cores are frozen after the presolve, exactly as in our optimizer.
// Compiled after the patched upstream uncertainty implementation so we reuse
// its observation-noise estimate, sparse factorization and covariance propagation.
std::vector<mrcal_point3_t> compute_uncertainty_at_distance(
    std::span<mrcal_point3_t> observations, std::span<double> intrinsics,
    std::span<mrcal_pose_t> poses, mrcal_calobject_warp_t warp, cv::Size imager, cv::Size board,
    double spacing, cv::Size samples, double distance, mrcal_lensmodel_t lensmodel) {
  if (!std::isfinite(distance) || distance < 0 || poses.empty())
    throw std::runtime_error(
        "Working distance must be nonnegative and finite (zero means infinity)");
  mrcal_problem_selections_t selections{};
  selections.do_optimize_intrinsics_core = lensmodel.type != MRCAL_LENSMODEL_SPLINED_STEREOGRAPHIC;
  selections.do_optimize_intrinsics_distortions = true;
  selections.do_optimize_extrinsics = true;
  selections.do_optimize_frames = true;
  selections.do_optimize_calobject_warp = true;
  selections.do_apply_regularization = true;
  selections.do_apply_outlier_rejection = true;
  std::vector<mrcal_observation_board_t> boards(poses.size());
  for (size_t i = 0; i < poses.size(); ++i) {
    boards[i].icam.intrinsics = 0;
    boards[i].icam.extrinsics = -1;
    boards[i].iframe = i;
  }
  auto context = create_calibration_uncertainty_context(
      selections, lensmodel, intrinsics, poses, boards.data(), observations.data(), poses.size(),
      board.width, board.height, spacing, imager, warp);
  int frames0 =
      mrcal_state_index_frames(0, 1, 0, poses.size(), 0, 0, poses.size(), selections, &lensmodel);
  auto pixels = sample_imager(samples, imager);
  std::vector<mrcal_point3_t> rays(pixels.size()), output;
  mrcal_unproject(rays.data(), pixels.data(), pixels.size(), &lensmodel, intrinsics.data());
  for (size_t i = 0; i < rays.size(); ++i) {
    auto p = rays[i];
    double norm = std::hypot(p.x, p.y, p.z);
    double value = std::numeric_limits<double>::quiet_NaN();
    if (std::isfinite(norm) && norm > 0) {
      for (int axis = 0; axis < 3; ++axis) p.xyz[axis] *= (distance > 0 ? distance : 1.0) / norm;
      mrcal_point2_t projected;
      Eigen::Matrix<double, 2, 3, Eigen::RowMajor> dq_dp;
      Eigen::Matrix<double, 2, Eigen::Dynamic, Eigen::RowMajor> dq_di(2, intrinsics.size());
      if (!mrcal_project(&projected, reinterpret_cast<mrcal_point3_t*>(dq_dp.data()), dq_di.data(),
                         &p, 1, &lensmodel, intrinsics.data()))
        throw std::runtime_error("Could not project working-distance sample");
      Eigen::Matrix<double, 2, Eigen::Dynamic, Eigen::RowMajor> gradient(2, context.Nstate);
      gradient.setZero();
      const int skip = selections.do_optimize_intrinsics_core ? 0 : 4;
      gradient.leftCols(intrinsics.size() - skip) = dq_di.rightCols(intrinsics.size() - skip);
      for (size_t f = 0; f < poses.size(); ++f) {
        mrcal_point3_t local, dummy;
        // Freeze the nominal point in each board's reference frame, then
        // differentiate its forward transform wrt all six pose coordinates.
        Eigen::Matrix<double, 3, 6, Eigen::RowMajor> dp_dpose;
        dp_dpose.setZero();
        if (distance > 0) {
          mrcal_transform_point_rt_inverted(local.xyz, nullptr, nullptr, &poses[f].r.x, p.xyz);
          mrcal_transform_point_rt(dummy.xyz, dp_dpose.data(), nullptr, &poses[f].r.x, local.xyz);
        } else {
          mrcal_rotate_point_r_inverted(local.xyz, nullptr, nullptr, poses[f].r.xyz, p.xyz);
          Eigen::Matrix<double, 3, 3, Eigen::RowMajor> dp_dr;
          mrcal_rotate_point_r(dummy.xyz, dp_dr.data(), nullptr, poses[f].r.xyz, local.xyz);
          dp_dpose.leftCols(3) = dp_dr;
        }
        gradient.block(0, frames0 + f * 6, 2, 6) = dq_dp * dp_dpose / poses.size();
      }
      value = _propagate_calibration_uncertainty_fast(context, gradient, selections, lensmodel,
                                                      intrinsics, poses, poses.size());
    }
    output.push_back({pixels[i].x, pixels[i].y, value});
  }
  return output;
}
