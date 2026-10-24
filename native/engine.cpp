// SPDX-License-Identifier: GPL-3.0-or-later
#include <Eigen/Dense>
#include <algorithm>
#include <cmath>
#include <iostream>
#include <opencv2/calib3d.hpp>
#include <opencv2/core.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/objdetect/charuco_detector.hpp>
#include <set>
#include <string>
#include <vector>

#include "json.hpp"
#include "lens-model.hpp"
#include "mrcal-uncertainty.hpp"
#include "mrcal_wrapper.h"
#include "uncertainty-distance.hpp"
#ifdef __EMSCRIPTEN__
#include <emscripten/bind.h>
#endif

using json = nlohmann::json;
using namespace cv;
struct Board {
  int cols, rows, dictionary;
  double spacing, marker;
  bool charuco, legacy;
  explicit Board(const json& j)
      : cols(j.at("columns")),
        rows(j.at("rows")),
        dictionary(j.value("dictionary", 3)),
        spacing(j.at("squareSize")),
        marker(j.value("markerSize", 0.01905)),
        charuco(j.value("kind", "charuco") == "charuco"),
        legacy(j.value("legacy", false)) {
    if (cols < 3 || rows < 3 || cols > 40 || rows > 40 || !std::isfinite(spacing) || spacing <= 0 ||
        spacing > 10)
      throw std::runtime_error("Invalid board dimensions or spacing");
    if (charuco && (!std::isfinite(marker) || marker <= 0 || marker >= spacing || dictionary < 0 ||
                    dictionary > 16))
      throw std::runtime_error("Marker size must be smaller than square size");
  }
  int count() const { return (cols - 1) * (rows - 1); }
  Size grid() const { return {cols - 1, rows - 1}; }
  aruco::CharucoBoard target() const {
    aruco::CharucoBoard board(Size(cols, rows), spacing, marker,
                              aruco::getPredefinedDictionary(dictionary));
    board.setLegacyPattern(legacy);
    return board;
  }
};
template <class F>
std::string guarded(F f) {
  try {
    return f().dump();
  } catch (const cv::Exception& e) {
    return json{{"error", std::string("Image processing failed: ") + e.what()}}.dump();
  } catch (const std::exception& e) {
    return json{{"error", e.what()}}.dump();
  }
}
void validateSize(int w, int h) {
  if (w < 16 || h < 16 || w > 8192 || h > 8192 || int64_t(w) * h > 33554432)
    throw std::runtime_error("Image dimensions exceed supported limits (32 megapixels)");
}
json analyzeImage(uintptr_t ptr, int w, int h, const json& options) {
  validateSize(w, h);
  Mat rgba(h, w, CV_8UC4, reinterpret_cast<void*>(ptr)), gray;
  cvtColor(rgba, gray, COLOR_RGBA2GRAY);
  auto region = options.value("roi", json{{"x", 0.25}, {"y", 0.25}, {"w", 0.5}, {"h", 0.5}});
  int x = std::clamp(int(region.at("x").get<double>() * w), 0, w - 2);
  int y = std::clamp(int(region.at("y").get<double>() * h), 0, h - 2);
  Rect rect(x, y, std::clamp(int(region.at("w").get<double>() * w), 2, w - x),
            std::clamp(int(region.at("h").get<double>() * h), 2, h - y));
  Mat roi = gray(rect), gx, gy, mag;
  Sobel(roi, gx, CV_32F, 1, 0, 3);
  Sobel(roi, gy, CV_32F, 0, 1, 3);
  magnitude(gx, gy, mag);
  Scalar avg, sd;
  meanStdDev(roi, avg, sd);
  json result = {{"sharpness", mean(mag)[0]},
                 {"brightness", avg[0]},
                 {"contrast", sd[0]},
                 {"clipped", double(countNonZero(roi < 3) + countNonZero(roi > 252)) / roi.total()},
                 {"corners", json::array()},
                 {"valid", false},
                 {"reason", "No board detected"}};
  if (!options.value("detect", true)) return result;
  Board board(options.at("board"));
  std::vector<Point2f> points;
  std::vector<int> ids;
  if (board.charuco) {
    aruco::CharucoDetector detector(board.target());
    detector.detectBoard(gray, points, ids);
  } else {
    if (findChessboardCornersSB(gray, board.grid(), points, CALIB_CB_NORMALIZE_IMAGE)) {
      for (int i = 0; i < int(points.size()); ++i) ids.push_back(i);
    }
  }
  for (size_t i = 0; i < ids.size(); ++i)
    result["corners"].push_back({{"id", ids[i]}, {"x", points[i].x}, {"y", points[i].y}});
  int minimum = board.charuco ? std::min(10, board.count()) : board.count();
  if (int(ids.size()) < minimum) {
    result["reason"] = "More board corners need to be visible";
    return result;
  }
  std::set<int> rows, cols;
  for (int id : ids) {
    rows.insert(id / (board.cols - 1));
    cols.insert(id % (board.cols - 1));
  }
  if (rows.size() < 2 || cols.size() < 2 || std::abs(contourArea([&] {
                                              std::vector<Point2f> hull;
                                              convexHull(points, hull);
                                              return hull;
                                            }())) < 25) {
    result["reason"] = "Show more of the board in both directions";
    return result;
  }
  Mat area = gray(boundingRect(points) & Rect(0, 0, w, h));
  meanStdDev(area, avg, sd);
  if (sd[0] < 10) {
    result["reason"] = "Board contrast is too low";
    return result;
  }
  result["valid"] = true;
  result["reason"] = "Board detected";
  return result;
}
struct Dataset {
  Board board;
  int width, height;
  std::vector<mrcal_point3_t> points;
  std::vector<mrcal_pose_t> poses;
  json frames;
  Dataset(const json& j)
      : board(j.at("board")), width(j.at("width")), height(j.at("height")), frames(j.at("frames")) {
    validateSize(width, height);
    if (frames.size() < 6 || frames.size() > 5000)
      throw std::runtime_error("A solve requires 6–5000 views");
    points.resize(frames.size() * board.count(), mrcal_point3_t{.x = -1, .y = -1, .z = -1});
    for (size_t f = 0; f < frames.size(); ++f) {
      std::set<int> seen;
      std::vector<Point2f> xy;
      for (const auto& c : frames[f].at("corners")) {
        int id = c.at("id");
        double x = c.at("x"), y = c.at("y");
        if (id < 0 || id >= board.count() || !seen.insert(id).second || !std::isfinite(x) ||
            !std::isfinite(y) || x < 0 || y < 0 || x >= width || y >= height)
          throw std::runtime_error("Invalid or duplicate corner coordinates");
        points[f * board.count() + id] = {.x = x, .y = y, .z = 1};
        xy.emplace_back(x, y);
      }
      if (seen.size() < 4) throw std::runtime_error("A view has too few corners");
      std::vector<Point2f> hull;
      convexHull(xy, hull);
      if (std::abs(contourArea(hull)) < 25)
        throw std::runtime_error("A view has collinear or tightly clustered corners");
    }
  }
};
#include "model-geometry.inc"
std::string solveCalibration(const std::string& input) {
  return guarded([&] {
    json request = json::parse(input);
    Dataset d(request);
    auto model = parse_model(request);
    const double hfov = request.value("fov", 90.0);
    if (!std::isfinite(hfov) || hfov < 10 || hfov > 170)
      throw std::runtime_error("Initial horizontal FOV must be 10–170 degrees");
    double focal = d.width / (4 * std::tan(hfov * M_PI / 720));
    for (size_t i = 0; i < d.frames.size(); ++i)
      d.poses.push_back(getSeedPose(d.points.data() + i * d.board.count(), d.board.grid(),
                                    {d.width, d.height}, d.board.spacing, focal));
    auto r = mrcal_main_model(d.points, d.poses, d.board.grid(), d.board.spacing,
                              {d.width, d.height}, focal, model);
    if (!r || !r->success || r->intrinsics.size() != size_t(mrcal_lensmodel_num_params(&model)) ||
        !std::all_of(r->intrinsics.begin(), r->intrinsics.end(),
                     [](double v) { return std::isfinite(v); }) ||
        r->intrinsics[0] <= 0 || r->intrinsics[1] <= 0 || !std::isfinite(r->calobject_warp.x2) ||
        !std::isfinite(r->calobject_warp.y2))
      throw std::runtime_error(
          "Calibration did not converge. Add diverse tilted views and check target dimensions.");
    json output = {{"lensModel", request.value("lensModel", "LENSMODEL_OPENCV8")},
                   {"intrinsics", r->intrinsics},
                   {"warp", {r->calobject_warp.x2, r->calobject_warp.y2}},
                   {"poses", json::array()},
                   {"views", json::array()},
                   {"weights", json::array()},
                   {"solverRms", r->rms_error}};
    double sum = 0, sumsq = 0;
    int total = 0, outliers = 0;
    for (size_t f = 0; f < d.frames.size(); ++f) {
      auto& pose = d.poses[f];
      output["poses"].push_back({pose.r.x, pose.r.y, pose.r.z, pose.t.x, pose.t.y, pose.t.z});
      json residuals = json::array(), used = json::array();
      double vsum = 0, vsq = 0;
      int vn = 0, vout = 0;
      for (const auto& c : d.frames[f]["corners"]) {
        int id = c["id"];
        int col = id % (d.board.cols - 1), row = id / (d.board.cols - 1);
        double xr = double(col) / (d.board.cols - 2), yr = double(row) / (d.board.rows - 2);
        mrcal_point3_t obj{.x = col * d.board.spacing,
                           .y = row * d.board.spacing,
                           .z = 4 * r->calobject_warp.x2 * xr * (1 - xr) +
                                4 * r->calobject_warp.y2 * yr * (1 - yr)},
            cam;
        mrcal_transform_point_rt(cam.xyz, nullptr, nullptr, &pose.r.x, obj.xyz);
        mrcal_point2_t q;
        mrcal_project(&q, nullptr, nullptr, &cam, 1, &model, r->intrinsics.data());
        double dx = q.x - c["x"].get<double>(), dy = q.y - c["y"].get<double>();
        bool inlier = d.points[f * d.board.count() + id].z > 0;
        used.push_back(inlier);
        residuals.push_back(
            {{"id", id}, {"dx", dx}, {"dy", dy}, {"x", c["x"]}, {"y", c["y"]}, {"used", inlier}});
        if (inlier) {
          double e = std::hypot(dx, dy);
          vsum += e;
          vsq += e * e;
          ++vn;
        } else
          ++vout;
      }
      for (int id = 0; id < d.board.count(); ++id)
        output["weights"].push_back(d.points[f * d.board.count() + id].z);
      output["views"].push_back({{"id", d.frames[f].value("id", std::to_string(f))},
                                 {"mean", vn ? vsum / vn : 0},
                                 {"rms", vn ? std::sqrt(vsq / vn) : 0},
                                 {"inliers", vn},
                                 {"outliers", vout},
                                 {"residuals", residuals}});
      sum += vsum;
      sumsq += vsq;
      total += vn;
      outliers += vout;
    }
    if (total < 20 || !std::isfinite(sumsq))
      throw std::runtime_error("Too few valid corners survived outlier rejection");
    output["modelGeometry"] = model_geometry(model, r->intrinsics, d.width, d.height);
    output["mean"] = sum / total;
    output["rms"] = std::sqrt(sumsq / total);
    output["inliers"] = total;
    output["outliers"] = outliers;
    return output;
  });
}
std::string uncertainty(const std::string& input) {
  return guarded([&] {
    auto request = json::parse(input);
    Dataset d(request);
    auto result = request.at("result");
    auto intrinsics = result.at("intrinsics").get<std::vector<double>>();
    auto model = parse_model(result);
    validate_intrinsics(model, intrinsics);
    auto weights = result.at("weights").get<std::vector<double>>();
    if (weights.size() != d.points.size() || result["poses"].size() != d.frames.size())
      throw std::runtime_error("Uncertainty inputs do not match the calibrated dataset");
    for (size_t i = 0; i < weights.size(); ++i) d.points[i].z = weights[i];
    for (auto& p : result["poses"])
      d.poses.push_back({.r = {.x = p.at(0), .y = p.at(1), .z = p.at(2)},
                         .t = {.x = p.at(3), .y = p.at(4), .z = p.at(5)}});
    mrcal_calobject_warp_t warp{.x2 = result["warp"].at(0), .y2 = result["warp"].at(1)};
    int cols = request.value("gridWidth", 60), rows = request.value("gridHeight", 40);
    if (cols < 2 || rows < 2 || cols > 100 || rows > 100)
      throw std::runtime_error("Invalid uncertainty grid");
    double distance = request.value("distance", 0.0);
    if (!std::isfinite(distance) || distance < 0)
      throw std::runtime_error("Invalid working distance");
    auto grid = compute_uncertainty_at_distance(d.points, intrinsics, d.poses, warp,
                                                {d.width, d.height}, d.board.grid(),
                                                d.board.spacing, {cols, rows}, distance, model);
    json values = json::array();
    for (auto& p : grid) values.push_back(std::isfinite(p.z) ? json(p.z) : json(nullptr));
    return json{{"width", cols},
                {"height", rows},
                {"values", values},
                {"method", "mean-pcam"},
                {"distance", distance > 0 ? json(distance) : json("infinity")}};
  });
}
std::string compareModels(const std::string& input) {
  return guarded([&] {
    auto j = json::parse(input);
    int w = j.at("width"), h = j.at("height"), cols = 60, rows = 40;
    validateSize(w, h);
    auto a = j["a"]["intrinsics"].get<std::vector<double>>(),
         b = j["b"]["intrinsics"].get<std::vector<double>>();
    auto modelA = parse_model(j["a"]), modelB = parse_model(j["b"]);
    validate_intrinsics(modelA, a);
    validate_intrinsics(modelB, b);
    std::vector<mrcal_point2_t> qs;
    for (int y = 0; y < rows; ++y)
      for (int x = 0; x < cols; ++x)
        qs.push_back({.x = (w - 1.) * x / (cols - 1), .y = (h - 1.) * y / (rows - 1)});
    std::vector<mrcal_point3_t> va(qs.size()), vb(qs.size());
    mrcal_unproject(va.data(), qs.data(), qs.size(), &modelA, a.data());
    mrcal_unproject(vb.data(), qs.data(), qs.size(), &modelB, b.data());
    Eigen::Matrix3d covariance = Eigen::Matrix3d::Zero();
    int valid = 0;
    for (size_t i = 0; i < qs.size(); ++i) {
      Eigen::Vector3d aa(va[i].x, va[i].y, va[i].z), bb(vb[i].x, vb[i].y, vb[i].z);
      if (!aa.allFinite() || !bb.allFinite() || aa.norm() < 1e-10 || bb.norm() < 1e-10) continue;
      double weight = 1.;
      if (j.contains("ua") && j.contains("ub") && !j["ua"][i].is_null() && !j["ub"][i].is_null()) {
        double p = j["ua"][i].get<double>() * j["ub"][i].get<double>();
        weight = 1 / std::max(p * p, 1e-12);
      } else if (std::hypot(qs[i].x - (w - 1) / 2., qs[i].y - (h - 1) / 2.) > std::min(w, h) / 6.)
        continue;
      covariance += weight * bb.normalized() * aa.normalized().transpose();
      ++valid;
    }
    if (valid < 3) throw std::runtime_error("Models have too little valid overlap");
    Eigen::JacobiSVD<Eigen::Matrix3d> svd(covariance, Eigen::ComputeFullU | Eigen::ComputeFullV);
    Eigen::Matrix3d correction = Eigen::Matrix3d::Identity();
    correction(2, 2) = (svd.matrixU() * svd.matrixV().transpose()).determinant();
    Eigen::Matrix3d rotation = svd.matrixU() * correction * svd.matrixV().transpose();
    json values = json::array();
    std::vector<double> errors;
    for (size_t i = 0; i < qs.size(); ++i) {
      Eigen::Vector3d v = rotation * Eigen::Vector3d(va[i].x, va[i].y, va[i].z);
      mrcal_point3_t p{.x = v.x(), .y = v.y(), .z = v.z()};
      mrcal_point2_t q;
      mrcal_project(&q, nullptr, nullptr, &p, 1, &modelB, b.data());
      double error = std::hypot(q.x - qs[i].x, q.y - qs[i].y);
      if (std::isfinite(error)) {
        errors.push_back(error);
        values.push_back(error);
      } else
        values.push_back(nullptr);
    }
    if (errors.empty()) throw std::runtime_error("Model comparison could not project any points");
    std::sort(errors.begin(), errors.end());
    double sum = 0;
    for (double e : errors) sum += e;
    return json{{"width", cols},
                {"height", rows},
                {"values", values},
                {"mean", sum / errors.size()},
                {"p95", errors[std::min(errors.size() - 1, size_t(errors.size() * .95))]}};
  });
}
std::string analyze(uintptr_t ptr, int w, int h, const std::string& input) {
  return guarded([&] { return analyzeImage(ptr, w, h, json::parse(input)); });
}
std::string renderBoard(uintptr_t ptr, int size, const std::string& input) {
  return guarded([&] {
    if (size < 100 || size > 4096) throw std::runtime_error("Invalid target image size");
    Board b(json::parse(input));
    Mat gray;
    if (b.charuco)
      b.target().generateImage({size, size}, gray, size / 160, 1);
    else {
      gray = Mat(size, size, CV_8UC1, Scalar(255));
      double square = double(size - 2 * (size / 160)) / std::max(b.cols, b.rows);
      double ox = (size - square * b.cols) / 2, oy = (size - square * b.rows) / 2;
      for (int y = 0; y < b.rows; ++y)
        for (int x = 0; x < b.cols; ++x)
          if ((x + y) % 2 == 0)
            rectangle(gray,
                      Rect(int(ox + x * square), int(oy + y * square), int(std::ceil(square)),
                           int(std::ceil(square))),
                      Scalar(0), FILLED);
    }
    Mat out(size, size, CV_8UC4, reinterpret_cast<void*>(ptr));
    cvtColor(gray, out, COLOR_GRAY2RGBA);
    return json{{"ok", true}};
  });
}
std::string undistortImage(uintptr_t source, uintptr_t dest, int w, int h,
                           const std::string& input) {
  return guarded([&] {
    validateSize(w, h);
    auto j = json::parse(input);
    if (j.is_array()) j = json{{"intrinsics", j}};
    auto model = parse_model(j);
    auto in = j.at("intrinsics").get<std::vector<double>>();
    validate_intrinsics(model, in);
    Mat src(h, w, CV_8UC4, reinterpret_cast<void*>(source)),
        out(h, w, CV_8UC4, reinterpret_cast<void*>(dest)), mapx(h, w, CV_32F), mapy(h, w, CV_32F);
    // Both models use the same centered pinhole output at the requested FOV.
    const double fov = j.value("previewFov", 90.0);
    if (!std::isfinite(fov) || fov < 10 || fov > 160)
      throw std::runtime_error("Invalid preview FOV");
    const double focal = w / (2 * std::tan(fov * M_PI / 360));
    std::vector<mrcal_point3_t> rays(w);
    std::vector<mrcal_point2_t> pixels(w);
    for (int y = 0; y < h; ++y) {
      for (int x = 0; x < w; ++x)
        rays[x] = {.x = (x - (w - 1) / 2.) / focal, .y = (y - (h - 1) / 2.) / focal, .z = 1};
      mrcal_project(pixels.data(), nullptr, nullptr, rays.data(), w, &model, in.data());
      for (int x = 0; x < w; ++x) {
        mapx.at<float>(y, x) = std::isfinite(pixels[x].x) ? pixels[x].x : -1;
        mapy.at<float>(y, x) = std::isfinite(pixels[x].y) ? pixels[x].y : -1;
      }
    }
    cv::remap(src, out, mapx, mapy, cv::INTER_LINEAR, cv::BORDER_CONSTANT);
    return json{{"ok", true}};
  });
}
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_BINDINGS(photoncal) {
  emscripten::function("analyze", &analyze);
  emscripten::function("solve", &solveCalibration);
  emscripten::function("uncertainty", &uncertainty);
  emscripten::function("compare", &compareModels);
  emscripten::function("renderBoard", &renderBoard);
  emscripten::function("undistort", &undistortImage);
}
#else
int main() {
  std::string input((std::istreambuf_iterator<char>(std::cin)), {});
  try {
    auto j = json::parse(input);
    auto op = j.value("op", "solve");
    std::string output = op == "uncertainty" ? uncertainty(input)
                         : op == "compare"   ? compareModels(input)
                                             : solveCalibration(input);
    std::cout << "\nPHOTONCAL_RESULT=" << output << std::endl;
    return json::parse(output).contains("error") ? 1 : 0;
  } catch (const std::exception& e) {
    std::cerr << e.what() << std::endl;
    return 1;
  }
}
#endif
