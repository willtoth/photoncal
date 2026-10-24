// Model-aware geometry used by plots. All rays are unit vectors in camera coordinates.
json model_geometry(const mrcal_lensmodel_t& model, const std::vector<double>& in, int w, int h) {
  auto ray = [&](double x, double y) {
    mrcal_point2_t q{.x = x, .y = y};
    mrcal_point3_t p;
    mrcal_unproject(&p, &q, 1, &model, in.data());
    double n = std::hypot(p.x, p.y, p.z);
    if (!std::isfinite(n) || n < 1e-12) return json(nullptr);
    return json::array({p.x / n, p.y / n, p.z / n});
  };
  json boundary = json::array();
  for (int side = 0; side < 4; ++side)
    for (int i = 0; i < 16; ++i) {
      double t = i / 16.;
      boundary.push_back(ray(side == 0   ? t * (w - 1)
                             : side == 1 ? w - 1
                             : side == 2 ? (1 - t) * (w - 1)
                                         : 0,
                             side == 0   ? 0
                             : side == 1 ? t * (h - 1)
                             : side == 2 ? h - 1
                                         : (1 - t) * (h - 1)));
    }
  json output{{"boundaryRays", boundary}};
  auto left = ray(0, (h - 1) / 2.), right = ray(w - 1, (h - 1) / 2.);
  if (!left.is_null() && !right.is_null()) {
    double dot = 0;
    for (int i = 0; i < 3; ++i) dot += left[i].get<double>() * right[i].get<double>();
    output["horizontalFov"] = std::acos(std::clamp(dot, -1., 1.)) * 180 / M_PI;
  }
  if (!splined(model)) return output;
  auto c = model.LENSMODEL_SPLINED_STEREOGRAPHIC__config;
  const double ux = 2 * std::tan(c.fov_x_deg * M_PI / 720.);
  const double segments = (c.Nx - 1 - (c.order == 3 ? 2 : 1)) / (2 * ux);
  const double uy = (c.Ny - 1 - (c.order == 3 ? 2 : 1)) / (2 * segments);
  const int cols = 40, rows = 30;
  json corrections = json::array(), bounds = json::array(), vectors = json::array(),
       knots = json::array();
  for (int y = 0; y < rows; ++y)
    for (int x = 0; x < cols; ++x) {
      double px = (w - 1.) * x / (cols - 1), py = (h - 1.) * y / (rows - 1);
      auto r = ray(px, py);
      if (r.is_null() || r[2].get<double>() < -0.999999) {
        corrections.push_back(nullptr);
        bounds.push_back(false);
        continue;
      }
      double u = 2 * r[0].get<double>() / (1 + r[2].get<double>()),
             v = 2 * r[1].get<double>() / (1 + r[2].get<double>());
      double dx = px - (in[0] * u + in[2]), dy = py - (in[1] * v + in[3]);
      corrections.push_back(std::hypot(dx, dy));
      bounds.push_back(std::abs(u) <= ux && std::abs(v) <= uy);
      vectors.push_back({{"x", px}, {"y", py}, {"dx", dx}, {"dy", dy}});
    }
  for (int y = 0; y < c.Ny; ++y)
    for (int x = 0; x < c.Nx; ++x) {
      double u = (x - (c.Nx - 1) / 2.) / segments, v = (y - (c.Ny - 1) / 2.) / segments;
      mrcal_point3_t p{.x = u, .y = v, .z = 1 - (u * u + v * v) / 4};
      mrcal_point2_t q;
      mrcal_project(&q, nullptr, nullptr, &p, 1, &model, in.data());
      knots.push_back(std::isfinite(q.x) && std::isfinite(q.y) ? json::array({q.x, q.y})
                                                               : json(nullptr));
    }
  output["correction"] = {{"width", cols}, {"height", rows}, {"values", corrections}};
  output["splineInBounds"] = bounds;
  output["knots"] = knots;
  output["correctionVectors"] = vectors;
  return output;
}
