#pragma once
#include <algorithm>
#include <cmath>
#include <json.hpp>
#include <regex>
#include <stdexcept>

#include "mrcal_wrapper.h"

inline mrcal_lensmodel_t parse_model(const nlohmann::json& value) {
  const std::string name = value.value("lensModel", "LENSMODEL_OPENCV8");
  mrcal_lensmodel_t model{};
  if (name != "LENSMODEL_OPENCV8") {
    std::smatch match;
    if (!std::regex_match(name, match,
                          std::regex("LENSMODEL_SPLINED_STEREOGRAPHIC_order=([23])_Nx=([0-9]{1,2})_"
                                     "Ny=([0-9]{1,2})_fov_x_deg=([0-9]{1,3})")))
      throw std::runtime_error("Unsupported lens model configuration");
    int nx = std::stoi(match[2]), ny = std::stoi(match[3]), fov = std::stoi(match[4]);
    if (nx < 6 || ny < 6 || nx > 40 || ny > 40 || fov < 20 || fov > 220)
      throw std::runtime_error("Spline grid must be 6–40 in each dimension and FOV 20–220 degrees");
  }
  if (!mrcal_lensmodel_from_name(&model, name.c_str()))
    throw std::runtime_error("Invalid lens model");
  return model;
}
inline bool splined(const mrcal_lensmodel_t& m) {
  return m.type == MRCAL_LENSMODEL_SPLINED_STEREOGRAPHIC;
}
inline void validate_intrinsics(const mrcal_lensmodel_t& model, const std::vector<double>& in) {
  if (in.size() != size_t(mrcal_lensmodel_num_params(&model)) ||
      !std::all_of(in.begin(), in.end(), [](double v) { return std::isfinite(v); }) || in[0] <= 0 ||
      in[1] <= 0)
    throw std::runtime_error("Invalid intrinsics for lens model");
}
std::unique_ptr<mrcal_result> mrcal_main_model(std::span<mrcal_point3_t>, std::span<mrcal_pose_t>,
                                               cv::Size, double, cv::Size, double,
                                               mrcal_lensmodel_t);
