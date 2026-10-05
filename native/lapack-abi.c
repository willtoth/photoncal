/* SPDX-License-Identifier: GPL-3.0-or-later
 * libdogleg uses the Fortran LAPACK ABI (hidden CHARACTER length and integer
 * return). The C-translated LAPACK routines omit that length and return void.
 * WebAssembly checks signatures strictly, so adapt them explicitly.
 */
void photoncal_dpptrf(char*, int*, double*, int*);
void photoncal_dpptrs(char*, int*, int*, double*, double*, int*, int*);
int dpptrf_(char* uplo, int* n, double* ap, int* info, int uplo_len) {
  (void)uplo_len;
  photoncal_dpptrf(uplo, n, ap, info);
  return 0;
}
int dpptrs_(char* uplo, int* n, int* nrhs, double* ap, double* b, int* ldb, int* info,
            int uplo_len) {
  (void)uplo_len;
  photoncal_dpptrs(uplo, n, nrhs, ap, b, ldb, info);
  return 0;
}
