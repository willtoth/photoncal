cmake_minimum_required(VERSION 3.25)
project(photoncal LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)

set(BUILD_LIST "core,imgproc,calib3d,objdetect" CACHE STRING "" FORCE)
set(BUILD_opencv_apps OFF CACHE BOOL "" FORCE)
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(BUILD_PERF_TESTS OFF CACHE BOOL "" FORCE)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_JAVA OFF CACHE BOOL "" FORCE)
set(WITH_IPP OFF CACHE BOOL "" FORCE)
set(WITH_OPENCL OFF CACHE BOOL "" FORCE)
set(WITH_PTHREADS_PF OFF CACHE BOOL "" FORCE)
set(WITH_ITT OFF CACHE BOOL "" FORCE)
set(WITH_LAPACK OFF CACHE BOOL "" FORCE)
set(WITH_PROTOBUF OFF CACHE BOOL "" FORCE)
set(OPENCV_ENABLE_NONFREE OFF CACHE BOOL "" FORCE)
if(EMSCRIPTEN)
  add_compile_options(-msimd128 -fexceptions)
  set(CV_ENABLE_INTRINSICS OFF CACHE BOOL "" FORCE)
endif()
add_subdirectory(${PHOTONCAL_DEPS}/opencv opencv EXCLUDE_FROM_ALL)

if(EMSCRIPTEN)
  set(BLAS_LIBRARIES ${PHOTONCAL_DEPS}/openblas/libopenblas.a CACHE STRING "" FORCE)
  set(LAPACK_LIBRARIES ${BLAS_LIBRARIES} CACHE STRING "" FORCE)
  set(BLAS_FOUND TRUE CACHE BOOL "" FORCE)
  set(LAPACK_FOUND TRUE CACHE BOOL "" FORCE)
endif()
set(SUITESPARSE_ENABLE_PROJECTS "suitesparse_config;amd;colamd;cholmod" CACHE STRING "" FORCE)
set(SUITESPARSE_USE_CUDA OFF CACHE BOOL "" FORCE)
set(SUITESPARSE_USE_FORTRAN OFF CACHE BOOL "" FORCE)
set(SUITESPARSE_USE_OPENMP OFF CACHE BOOL "" FORCE)
set(SUITESPARSE_DEMOS OFF CACHE BOOL "" FORCE)
set(CHOLMOD_GPL OFF CACHE BOOL "" FORCE)
set(CHOLMOD_PARTITION OFF CACHE BOOL "" FORCE)
set(CHOLMOD_SUPERNODAL OFF CACHE BOOL "" FORCE)
set(SUITESPARSE_USE_64BIT_BLAS OFF CACHE BOOL "" FORCE)
add_subdirectory(${PHOTONCAL_DEPS}/suitesparse suitesparse EXCLUDE_FROM_ALL)

set(MRCAL ${PHOTONCAL_DEPS}/mrcal)
find_package(Perl REQUIRED)
execute_process(COMMAND ${PERL_EXECUTABLE} ${MRCAL}/minimath/minimath_generate.pl
  OUTPUT_FILE ${MRCAL}/minimath/minimath_generated.h COMMAND_ERROR_IS_FATAL ANY)
set(PV ${PHOTONCAL_DEPS}/mrcal-java/src)
# Keep upstream source pristine. Only deterministic seeding and a checked solve
# status differ in our wrapper copy; see patches documented in THIRD_PARTY.md.
file(READ ${PV}/mrcal_wrapper.cpp WRAPPER)
string(REPLACE "std::mt19937 gen(rd());" "std::mt19937 gen(0);" WRAPPER "${WRAPPER}")
string(REPLACE "true, intrinsics, stats.rms_reproj_error__pixels" "std::isfinite(stats.rms_reproj_error__pixels) && stats.rms_reproj_error__pixels >= 0, intrinsics, stats.rms_reproj_error__pixels" WRAPPER "${WRAPPER}")
string(REPLACE "mrcal_lensmodel, intrinsics);" "mrcal_lensmodel, intrinsics);\n    if (!result || !result->success) return result;" WRAPPER "${WRAPPER}")
string(REPLACE "mrcal_lensmodel, result->intrinsics);" "mrcal_lensmodel, result->intrinsics);\n    if (!result || !result->success) return result;" WRAPPER "${WRAPPER}")
file(WRITE ${CMAKE_CURRENT_BINARY_DIR}/mrcal_wrapper.cpp "${WRAPPER}")
file(READ ${PV}/mrcal-uncertainty.cpp UNCERTAINTY)
string(REPLACE "int N_j_nonzero = Nstate * Nmeasurements;" "int N_j_nonzero = _mrcal_num_j_nonzero(Nobservations_board, 0, nullptr, 0, calibration_object_width_n, calibration_object_height_n, 1, 0, rt_ref_frame.size(), 0, 0, observations_board, nullptr, problem_selections, &lensmodel);" UNCERTAINTY "${UNCERTAINTY}")
string(REPLACE "1, 0, 6, 0, 0, problem_selections" "1, 0, rt_ref_frame.size(), 0, 0, problem_selections" UNCERTAINTY "${UNCERTAINTY}")
string(REPLACE "1, 0, 6, 0, 0, 6," "1, 0, rt_ref_frames.size(), 0, 0, rt_ref_frames.size()," UNCERTAINTY "${UNCERTAINTY}")
# The upstream variance estimator includes zero residuals for missing/outlier
# corners. Count observed inlier coordinates so partial views don't look better.
string(REPLACE "double mean = sum / x.size();" "double mean = sum / num_measurements_board;" UNCERTAINTY "${UNCERTAINTY}")
string(REPLACE "(sum_sq / x.size())" "(sum_sq / num_measurements_board)" UNCERTAINTY "${UNCERTAINTY}")
string(REPLACE "double observed_pixel_uncertainty =\n      _observed_pixel_uncertainty_from_inputs(x, Nmeasurements_boards, imeas0);" "std::vector<double> inlier_residuals;\n  for (int i = 0; i < Nmeasurements_boards / 2; ++i) if (observations_board_pool[i].z > 0) { inlier_residuals.push_back(x[imeas0 + 2*i]); inlier_residuals.push_back(x[imeas0 + 2*i + 1]); }\n  if (inlier_residuals.empty()) throw std::runtime_error(\"No inliers for uncertainty\");\n  double observed_pixel_uncertainty = _observed_pixel_uncertainty_from_inputs(inlier_residuals, inlier_residuals.size(), 0);" UNCERTAINTY "${UNCERTAINTY}")
file(WRITE ${CMAKE_CURRENT_BINARY_DIR}/uncertainty.cpp "#include <mrcal.h>\n#include <internal.h>\n${UNCERTAINTY}")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/uncertainty-distance.inc)
file(READ ${CMAKE_CURRENT_SOURCE_DIR}/uncertainty-distance.inc DISTANCE_UNCERTAINTY)
file(APPEND ${CMAKE_CURRENT_BINARY_DIR}/uncertainty.cpp "\n${DISTANCE_UNCERTAINTY}\n")

add_library(calibration STATIC
  ${CMAKE_CURRENT_BINARY_DIR}/mrcal_wrapper.cpp
  ${PHOTONCAL_DEPS}/libdogleg/dogleg.c
  ${MRCAL}/mrcal.c ${MRCAL}/cahvore.cc ${MRCAL}/poseutils-opencv.c
  ${MRCAL}/poseutils-uses-autodiff.cc ${MRCAL}/poseutils.c
  ${MRCAL}/opencv.c ${MRCAL}/triangulation.cc)
target_include_directories(calibration PUBLIC ${PV} ${MRCAL} ${PHOTONCAL_DEPS} ${PHOTONCAL_DEPS}/libdogleg ${PHOTONCAL_DEPS}/eigen
  ${PHOTONCAL_DEPS}/opencv/modules/core/include ${PHOTONCAL_DEPS}/opencv/modules/imgproc/include
  ${PHOTONCAL_DEPS}/opencv/modules/calib3d/include ${PHOTONCAL_DEPS}/opencv/modules/objdetect/include
  ${PHOTONCAL_DEPS}/opencv/modules/features2d/include ${PHOTONCAL_DEPS}/opencv/modules/flann/include
  ${CMAKE_CURRENT_BINARY_DIR} ${CMAKE_CURRENT_BINARY_DIR}/opencv)
target_link_libraries(calibration PUBLIC opencv_calib3d opencv_objdetect opencv_imgproc opencv_core SuiteSparse::CHOLMOD_static)
if(EMSCRIPTEN)
  target_sources(calibration PRIVATE lapack-abi.c ${PHOTONCAL_DEPS}/openblas/lapack-netlib/SRC/dpptrf.c ${PHOTONCAL_DEPS}/openblas/lapack-netlib/SRC/dpptrs.c)
  set_source_files_properties(${PHOTONCAL_DEPS}/openblas/lapack-netlib/SRC/dpptrf.c PROPERTIES COMPILE_DEFINITIONS "dpptrf_=photoncal_dpptrf")
  set_source_files_properties(${PHOTONCAL_DEPS}/openblas/lapack-netlib/SRC/dpptrs.c PROPERTIES COMPILE_DEFINITIONS "dpptrs_=photoncal_dpptrs")
  target_link_libraries(calibration PUBLIC ${BLAS_LIBRARIES})
else()
  find_package(LAPACK REQUIRED)
  target_link_libraries(calibration PUBLIC ${LAPACK_LIBRARIES})
endif()

add_executable(photoncal engine.cpp ${CMAKE_CURRENT_BINARY_DIR}/uncertainty.cpp)
target_link_libraries(photoncal PRIVATE calibration)
if(EMSCRIPTEN)
  set_target_properties(photoncal PROPERTIES SUFFIX ".js")
  target_link_options(photoncal PRIVATE --bind -msimd128 -fexceptions
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createPhotonCal
    -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1
    -sMAXIMUM_MEMORY=2147483648 -sSTACK_SIZE=4194304
    -sEXPORTED_FUNCTIONS=_malloc,_free -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPF64
    -sFILESYSTEM=0 -sASSERTIONS=1)
endif()
