#pragma once
#include "mrcal-uncertainty.hpp"

std::vector<mrcal_point3_t> compute_uncertainty_at_distance(
    std::span<mrcal_point3_t> observations, std::span<double> intrinsics,
    std::span<mrcal_pose_t> poses, mrcal_calobject_warp_t warp, cv::Size imager, cv::Size board,
    double spacing, cv::Size samples, double distance, mrcal_lensmodel_t lensmodel);
