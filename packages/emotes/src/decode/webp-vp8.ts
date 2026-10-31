import { corrupt, overBudget, unsupported } from './errors';

/**
 * WebP lossy (VP8) decoder, written from RFC 6386. A WebP 'VP8 ' chunk holds exactly one VP8 key frame,
 * so only intra coding is implemented: the boolean entropy decoder, the frame header (segmentation,
 * loop-filter deltas, token partitions, quantizer deltas, coefficient probability updates), key-frame
 * mode parsing with B_PRED subblock contexts, token decoding, dequantization, the inverse WHT and DCT,
 * intra prediction, and both loop filters. The output conversion matches libwebp's default RGB output
 * (the decoder browsers and Pillow use): 4:2:0 chroma is upsampled with the "fancy" 9-3-3-1 filter and
 * converted with libwebp's 14-bit fixed-point BT.601 coefficients.
 *
 * Hostile input: the declared size is checked against the caller's limit before anything is
 * allocated, every partition must lie inside the data, and every loop is bounded by the macroblock
 * count. Like the reference decoder, a boolean decoder that runs off the end of its partition reads
 * zeros; garbage in yields a garbage picture, never a hang or an out-of-bounds access.
 */

export interface Vp8Header {
  width: number;
  height: number;
}

const FRAME_HEADER_BYTES = 10;

// Macroblock-level luma modes (RFC 6386 §11.2). The first four also name the chroma modes.
const DC_PRED = 0;
const V_PRED = 1;
const H_PRED = 2;
const TM_PRED = 3;
const B_PRED = 4;

// Subblock modes (RFC 6386 §11.2), in bitstream enumeration order.
const B_DC_PRED = 0;
const B_TM_PRED = 1;
const B_VE_PRED = 2;
const B_HE_PRED = 3;
const B_LD_PRED = 4;
const B_RD_PRED = 5;
const B_VR_PRED = 6;
const B_VL_PRED = 7;
const B_HD_PRED = 8;
const B_HU_PRED = 9;
const NUM_BMODES = 10;

/** Subblock mode implied by each 16x16 luma mode, for the contexts of later B_PRED neighbours (§11.3). */
const IMPLIED_BMODE = Uint8Array.of(B_DC_PRED, B_VE_PRED, B_HE_PRED, B_TM_PRED);

/**
 * Tree encodings (RFC 6386 §8.1): a positive entry is the index of the next node pair, a non-positive
 * entry is a negated leaf value. Probability i belongs to the node pair starting at 2 * i.
 */
const BMODE_TREE = Int8Array.of(
  -B_DC_PRED, 2,
  -B_TM_PRED, 4,
  -B_VE_PRED, 6,
  8, 12,
  -B_HE_PRED, 10,
  -B_RD_PRED, -B_VR_PRED,
  -B_LD_PRED, 14,
  -B_VL_PRED, 16,
  -B_HD_PRED, -B_HU_PRED,
);

/** mb_segment_tree (RFC 6386 §9.3). */
const SEGMENT_TREE = Int8Array.of(2, 4, -0, -1, -2, -3);

const KF_YMODE_PROBS = Uint8Array.of(145, 156, 163, 128);
const KF_UV_MODE_PROBS = Uint8Array.of(142, 114, 183);

/** kf_bmode_prob[above][left][9] (RFC 6386 §11.5), flattened. */
const KF_BMODE_PROBS = Uint8Array.of(
  231, 120, 48, 89, 115, 113, 120, 152, 112, 152, 179, 64, 126, 170, 118, 46, 70, 95,
  175, 69, 143, 80, 85, 82, 72, 155, 103, 56, 58, 10, 171, 218, 189, 17, 13, 152,
  144, 71, 10, 38, 171, 213, 144, 34, 26, 114, 26, 17, 163, 44, 195, 21, 10, 173,
  121, 24, 80, 195, 26, 62, 44, 64, 85, 170, 46, 55, 19, 136, 160, 33, 206, 71,
  63, 20, 8, 114, 114, 208, 12, 9, 226, 81, 40, 11, 96, 182, 84, 29, 16, 36,
  134, 183, 89, 137, 98, 101, 106, 165, 148, 72, 187, 100, 130, 157, 111, 32, 75, 80,
  66, 102, 167, 99, 74, 62, 40, 234, 128, 41, 53, 9, 178, 241, 141, 26, 8, 107,
  104, 79, 12, 27, 217, 255, 87, 17, 7, 74, 43, 26, 146, 73, 166, 49, 23, 157,
  65, 38, 105, 160, 51, 52, 31, 115, 128, 87, 68, 71, 44, 114, 51, 15, 186, 23,
  47, 41, 14, 110, 182, 183, 21, 17, 194, 66, 45, 25, 102, 197, 189, 23, 18, 22,
  88, 88, 147, 150, 42, 46, 45, 196, 205, 43, 97, 183, 117, 85, 38, 35, 179, 61,
  39, 53, 200, 87, 26, 21, 43, 232, 171, 56, 34, 51, 104, 114, 102, 29, 93, 77,
  107, 54, 32, 26, 51, 1, 81, 43, 31, 39, 28, 85, 171, 58, 165, 90, 98, 64,
  34, 22, 116, 206, 23, 34, 43, 166, 73, 68, 25, 106, 22, 64, 171, 36, 225, 114,
  34, 19, 21, 102, 132, 188, 16, 76, 124, 62, 18, 78, 95, 85, 57, 50, 48, 51,
  193, 101, 35, 159, 215, 111, 89, 46, 111, 60, 148, 31, 172, 219, 228, 21, 18, 111,
  112, 113, 77, 85, 179, 255, 38, 120, 114, 40, 42, 1, 196, 245, 209, 10, 25, 109,
  100, 80, 8, 43, 154, 1, 51, 26, 71, 88, 43, 29, 140, 166, 213, 37, 43, 154,
  61, 63, 30, 155, 67, 45, 68, 1, 209, 142, 78, 78, 16, 255, 128, 34, 197, 171,
  41, 40, 5, 102, 211, 183, 4, 1, 221, 51, 50, 17, 168, 209, 192, 23, 25, 82,
  125, 98, 42, 88, 104, 85, 117, 175, 82, 95, 84, 53, 89, 128, 100, 113, 101, 45,
  75, 79, 123, 47, 51, 128, 81, 171, 1, 57, 17, 5, 71, 102, 57, 53, 41, 49,
  115, 21, 2, 10, 102, 255, 166, 23, 6, 38, 33, 13, 121, 57, 73, 26, 1, 85,
  41, 10, 67, 138, 77, 110, 90, 47, 114, 101, 29, 16, 10, 85, 128, 101, 196, 26,
  57, 18, 10, 102, 102, 213, 34, 20, 43, 117, 20, 15, 36, 163, 128, 68, 1, 26,
  138, 31, 36, 171, 27, 166, 38, 44, 229, 67, 87, 58, 169, 82, 115, 26, 59, 179,
  63, 59, 90, 180, 59, 166, 93, 73, 154, 40, 40, 21, 116, 143, 209, 34, 39, 175,
  57, 46, 22, 24, 128, 1, 54, 17, 37, 47, 15, 16, 183, 34, 223, 49, 45, 183,
  46, 17, 33, 183, 6, 98, 15, 32, 183, 65, 32, 73, 115, 28, 128, 23, 128, 205,
  40, 3, 9, 115, 51, 192, 18, 6, 223, 87, 37, 9, 115, 59, 77, 64, 21, 47,
  104, 55, 44, 218, 9, 54, 53, 130, 226, 64, 90, 70, 205, 40, 41, 23, 26, 57,
  54, 57, 112, 184, 5, 41, 38, 166, 213, 30, 34, 26, 133, 152, 116, 10, 32, 134,
  75, 32, 12, 51, 192, 255, 160, 43, 51, 39, 19, 53, 221, 26, 114, 32, 73, 255,
  31, 9, 65, 234, 2, 15, 1, 118, 73, 88, 31, 35, 67, 102, 85, 55, 186, 85,
  56, 21, 23, 111, 59, 205, 45, 37, 192, 55, 38, 70, 124, 73, 102, 1, 34, 98,
  102, 61, 71, 37, 34, 53, 31, 243, 192, 69, 60, 71, 38, 73, 119, 28, 222, 37,
  68, 45, 128, 34, 1, 47, 11, 245, 171, 62, 17, 19, 70, 146, 85, 55, 62, 70,
  75, 15, 9, 9, 64, 255, 184, 119, 16, 37, 43, 37, 154, 100, 163, 85, 160, 1,
  63, 9, 92, 136, 28, 64, 32, 201, 85, 86, 6, 28, 5, 64, 255, 25, 248, 1,
  56, 8, 17, 132, 137, 255, 55, 116, 128, 58, 15, 20, 82, 135, 57, 26, 121, 40,
  164, 50, 31, 137, 154, 133, 25, 35, 218, 51, 103, 44, 131, 131, 123, 31, 6, 158,
  86, 40, 64, 135, 148, 224, 45, 183, 128, 22, 26, 17, 131, 240, 154, 14, 1, 209,
  83, 12, 13, 54, 192, 255, 68, 47, 28, 45, 16, 21, 91, 64, 222, 7, 1, 197,
  56, 21, 39, 155, 60, 138, 23, 102, 213, 85, 26, 85, 85, 128, 128, 32, 146, 171,
  18, 11, 7, 63, 144, 171, 4, 4, 246, 35, 27, 10, 146, 174, 171, 12, 26, 128,
  190, 80, 35, 99, 180, 80, 126, 54, 45, 85, 126, 47, 87, 176, 51, 41, 20, 32,
  101, 75, 128, 139, 118, 146, 116, 128, 85, 56, 41, 15, 176, 236, 85, 37, 9, 62,
  146, 36, 19, 30, 171, 255, 97, 27, 20, 71, 30, 17, 119, 118, 255, 17, 18, 138,
  101, 38, 60, 138, 55, 70, 43, 26, 142, 138, 45, 61, 62, 219, 1, 81, 188, 64,
  32, 41, 20, 117, 151, 142, 20, 21, 163, 112, 19, 12, 61, 195, 128, 48, 4, 24,
);

const NUM_BLOCK_TYPES = 4;
const NUM_BANDS = 8;
const NUM_CONTEXTS = 3;
const NUM_TOKEN_PROBS = 11;
const COEFF_PROB_COUNT = NUM_BLOCK_TYPES * NUM_BANDS * NUM_CONTEXTS * NUM_TOKEN_PROBS;

/** coeff_update_probs[4][8][3][11] (RFC 6386 §13.4), flattened. */
const COEFF_UPDATE_PROBS = Uint8Array.of(
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 176, 246, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  223, 241, 252, 255, 255, 255, 255, 255, 255, 255, 255, 249, 253, 253, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 244, 252, 255, 255, 255, 255, 255, 255, 255, 255, 234, 254, 254, 255, 255, 255, 255, 255, 255, 255, 255,
  253, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 246, 254, 255, 255, 255, 255, 255, 255, 255, 255,
  239, 253, 254, 255, 255, 255, 255, 255, 255, 255, 255, 254, 255, 254, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 248, 254, 255, 255, 255, 255, 255, 255, 255, 255, 251, 255, 254, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 253, 254, 255, 255, 255, 255, 255, 255, 255, 255,
  251, 254, 254, 255, 255, 255, 255, 255, 255, 255, 255, 254, 255, 254, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 254, 253, 255, 254, 255, 255, 255, 255, 255, 255, 250, 255, 254, 255, 254, 255, 255, 255, 255, 255, 255,
  254, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  217, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 225, 252, 241, 253, 255, 255, 254, 255, 255, 255, 255,
  234, 250, 241, 250, 253, 255, 253, 254, 255, 255, 255, 255, 254, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  223, 254, 254, 255, 255, 255, 255, 255, 255, 255, 255, 238, 253, 254, 254, 255, 255, 255, 255, 255, 255, 255,
  255, 248, 254, 255, 255, 255, 255, 255, 255, 255, 255, 249, 254, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 253, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  247, 254, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 253, 254, 255, 255, 255, 255, 255, 255, 255, 255, 252, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 254, 254, 255, 255, 255, 255, 255, 255, 255, 255,
  253, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 254, 253, 255, 255, 255, 255, 255, 255, 255, 255, 250, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  254, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  186, 251, 250, 255, 255, 255, 255, 255, 255, 255, 255, 234, 251, 244, 254, 255, 255, 255, 255, 255, 255, 255,
  251, 251, 243, 253, 254, 255, 254, 255, 255, 255, 255, 255, 253, 254, 255, 255, 255, 255, 255, 255, 255, 255,
  236, 253, 254, 255, 255, 255, 255, 255, 255, 255, 255, 251, 253, 253, 254, 254, 255, 255, 255, 255, 255, 255,
  255, 254, 254, 255, 255, 255, 255, 255, 255, 255, 255, 254, 254, 254, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 254, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  254, 254, 255, 255, 255, 255, 255, 255, 255, 255, 255, 254, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 254, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  248, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 250, 254, 252, 254, 255, 255, 255, 255, 255, 255, 255,
  248, 254, 249, 253, 255, 255, 255, 255, 255, 255, 255, 255, 253, 253, 255, 255, 255, 255, 255, 255, 255, 255,
  246, 253, 253, 255, 255, 255, 255, 255, 255, 255, 255, 252, 254, 251, 254, 254, 255, 255, 255, 255, 255, 255,
  255, 254, 252, 255, 255, 255, 255, 255, 255, 255, 255, 248, 254, 253, 255, 255, 255, 255, 255, 255, 255, 255,
  253, 255, 254, 254, 255, 255, 255, 255, 255, 255, 255, 255, 251, 254, 255, 255, 255, 255, 255, 255, 255, 255,
  245, 251, 254, 255, 255, 255, 255, 255, 255, 255, 255, 253, 253, 254, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 251, 253, 255, 255, 255, 255, 255, 255, 255, 255, 252, 253, 254, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 254, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 252, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  249, 255, 254, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 254, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 253, 255, 255, 255, 255, 255, 255, 255, 255, 250, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  254, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
);

/** default_coeff_probs[4][8][3][11] (RFC 6386 §13.5), flattened. */
const DEFAULT_COEFF_PROBS = Uint8Array.of(
  128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128,
  128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 253, 136, 254, 255, 228, 219, 128, 128, 128, 128, 128,
  189, 129, 242, 255, 227, 213, 255, 219, 128, 128, 128, 106, 126, 227, 252, 214, 209, 255, 255, 128, 128, 128,
  1, 98, 248, 255, 236, 226, 255, 255, 128, 128, 128, 181, 133, 238, 254, 221, 234, 255, 154, 128, 128, 128,
  78, 134, 202, 247, 198, 180, 255, 219, 128, 128, 128, 1, 185, 249, 255, 243, 255, 128, 128, 128, 128, 128,
  184, 150, 247, 255, 236, 224, 128, 128, 128, 128, 128, 77, 110, 216, 255, 236, 230, 128, 128, 128, 128, 128,
  1, 101, 251, 255, 241, 255, 128, 128, 128, 128, 128, 170, 139, 241, 252, 236, 209, 255, 255, 128, 128, 128,
  37, 116, 196, 243, 228, 255, 255, 255, 128, 128, 128, 1, 204, 254, 255, 245, 255, 128, 128, 128, 128, 128,
  207, 160, 250, 255, 238, 128, 128, 128, 128, 128, 128, 102, 103, 231, 255, 211, 171, 128, 128, 128, 128, 128,
  1, 152, 252, 255, 240, 255, 128, 128, 128, 128, 128, 177, 135, 243, 255, 234, 225, 128, 128, 128, 128, 128,
  80, 129, 211, 255, 194, 224, 128, 128, 128, 128, 128, 1, 1, 255, 128, 128, 128, 128, 128, 128, 128, 128,
  246, 1, 255, 128, 128, 128, 128, 128, 128, 128, 128, 255, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128,
  198, 35, 237, 223, 193, 187, 162, 160, 145, 155, 62, 131, 45, 198, 221, 172, 176, 220, 157, 252, 221, 1,
  68, 47, 146, 208, 149, 167, 221, 162, 255, 223, 128, 1, 149, 241, 255, 221, 224, 255, 255, 128, 128, 128,
  184, 141, 234, 253, 222, 220, 255, 199, 128, 128, 128, 81, 99, 181, 242, 176, 190, 249, 202, 255, 255, 128,
  1, 129, 232, 253, 214, 197, 242, 196, 255, 255, 128, 99, 121, 210, 250, 201, 198, 255, 202, 128, 128, 128,
  23, 91, 163, 242, 170, 187, 247, 210, 255, 255, 128, 1, 200, 246, 255, 234, 255, 128, 128, 128, 128, 128,
  109, 178, 241, 255, 231, 245, 255, 255, 128, 128, 128, 44, 130, 201, 253, 205, 192, 255, 255, 128, 128, 128,
  1, 132, 239, 251, 219, 209, 255, 165, 128, 128, 128, 94, 136, 225, 251, 218, 190, 255, 255, 128, 128, 128,
  22, 100, 174, 245, 186, 161, 255, 199, 128, 128, 128, 1, 182, 249, 255, 232, 235, 128, 128, 128, 128, 128,
  124, 143, 241, 255, 227, 234, 128, 128, 128, 128, 128, 35, 77, 181, 251, 193, 211, 255, 205, 128, 128, 128,
  1, 157, 247, 255, 236, 231, 255, 255, 128, 128, 128, 121, 141, 235, 255, 225, 227, 255, 255, 128, 128, 128,
  45, 99, 188, 251, 195, 217, 255, 224, 128, 128, 128, 1, 1, 251, 255, 213, 255, 128, 128, 128, 128, 128,
  203, 1, 248, 255, 255, 128, 128, 128, 128, 128, 128, 137, 1, 177, 255, 224, 255, 128, 128, 128, 128, 128,
  253, 9, 248, 251, 207, 208, 255, 192, 128, 128, 128, 175, 13, 224, 243, 193, 185, 249, 198, 255, 255, 128,
  73, 17, 171, 221, 161, 179, 236, 167, 255, 234, 128, 1, 95, 247, 253, 212, 183, 255, 255, 128, 128, 128,
  239, 90, 244, 250, 211, 209, 255, 255, 128, 128, 128, 155, 77, 195, 248, 188, 195, 255, 255, 128, 128, 128,
  1, 24, 239, 251, 218, 219, 255, 205, 128, 128, 128, 201, 51, 219, 255, 196, 186, 128, 128, 128, 128, 128,
  69, 46, 190, 239, 201, 218, 255, 228, 128, 128, 128, 1, 191, 251, 255, 255, 128, 128, 128, 128, 128, 128,
  223, 165, 249, 255, 213, 255, 128, 128, 128, 128, 128, 141, 124, 248, 255, 255, 128, 128, 128, 128, 128, 128,
  1, 16, 248, 255, 255, 128, 128, 128, 128, 128, 128, 190, 36, 230, 255, 236, 255, 128, 128, 128, 128, 128,
  149, 1, 255, 128, 128, 128, 128, 128, 128, 128, 128, 1, 226, 255, 128, 128, 128, 128, 128, 128, 128, 128,
  247, 192, 255, 128, 128, 128, 128, 128, 128, 128, 128, 240, 128, 255, 128, 128, 128, 128, 128, 128, 128, 128,
  1, 134, 252, 255, 255, 128, 128, 128, 128, 128, 128, 213, 62, 250, 255, 255, 128, 128, 128, 128, 128, 128,
  55, 93, 255, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128,
  128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128,
  202, 24, 213, 235, 186, 191, 220, 160, 240, 175, 255, 126, 38, 182, 232, 169, 184, 228, 174, 255, 187, 128,
  61, 46, 138, 219, 151, 178, 240, 170, 255, 216, 128, 1, 112, 230, 250, 199, 191, 247, 159, 255, 255, 128,
  166, 109, 228, 252, 211, 215, 255, 174, 128, 128, 128, 39, 77, 162, 232, 172, 180, 245, 178, 255, 255, 128,
  1, 52, 220, 246, 198, 199, 249, 220, 255, 255, 128, 124, 74, 191, 243, 183, 193, 250, 221, 255, 255, 128,
  24, 71, 130, 219, 154, 170, 243, 182, 255, 255, 128, 1, 182, 225, 249, 219, 240, 255, 224, 128, 128, 128,
  149, 150, 226, 252, 216, 205, 255, 171, 128, 128, 128, 28, 108, 170, 242, 183, 194, 254, 223, 255, 255, 128,
  1, 81, 230, 252, 204, 203, 255, 192, 128, 128, 128, 123, 102, 209, 247, 188, 196, 255, 233, 128, 128, 128,
  20, 95, 153, 243, 164, 173, 255, 203, 128, 128, 128, 1, 222, 248, 255, 216, 213, 128, 128, 128, 128, 128,
  168, 175, 246, 252, 235, 205, 255, 255, 128, 128, 128, 47, 116, 215, 255, 211, 212, 255, 255, 128, 128, 128,
  1, 121, 236, 253, 212, 214, 255, 255, 128, 128, 128, 141, 84, 213, 252, 201, 202, 255, 219, 128, 128, 128,
  42, 80, 160, 240, 162, 185, 255, 205, 128, 128, 128, 1, 1, 255, 128, 128, 128, 128, 128, 128, 128, 128,
  244, 1, 255, 128, 128, 128, 128, 128, 128, 128, 128, 238, 1, 255, 128, 128, 128, 128, 128, 128, 128, 128,
);

// Block types indexing the outer dimension of the coefficient probabilities (§13.3).
const TYPE_Y_AFTER_Y2 = 0;
const TYPE_Y2 = 1;
const TYPE_UV = 2;
const TYPE_Y_WITH_DC = 3;

/** Band of each coefficient position, pre-multiplied into an offset; entry 16 is a harmless sentinel. */
const BAND_OFFSET = Uint16Array.from([0, 1, 2, 3, 6, 4, 5, 6, 6, 6, 6, 6, 6, 6, 6, 7, 0], (band) => band * NUM_CONTEXTS * NUM_TOKEN_PROBS);
const ZIGZAG = Uint8Array.of(0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15);

/** Extra-bit probabilities of DCT_CAT1..DCT_CAT6, most significant bit first (§13.2). */
const CAT_PROBS: readonly Uint8Array[] = [
  Uint8Array.of(159),
  Uint8Array.of(165, 145),
  Uint8Array.of(173, 148, 140),
  Uint8Array.of(176, 155, 140, 135),
  Uint8Array.of(180, 157, 141, 134, 130),
  Uint8Array.of(254, 254, 243, 230, 196, 177, 153, 140, 133, 130, 129),
];
const CAT_BASE = Uint8Array.of(5, 7, 11, 19, 35, 67);

/** dc_qlookup (RFC 6386 §14.1). */
const DC_QUANT = Uint16Array.of(
  4, 5, 6, 7, 8, 9, 10, 10, 11, 12, 13, 14, 15, 16, 17, 17,
  18, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 25, 25, 26, 27, 28,
  29, 30, 31, 32, 33, 34, 35, 36, 37, 37, 38, 39, 40, 41, 42, 43,
  44, 45, 46, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58,
  59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74,
  75, 76, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 93, 95, 96, 98, 100, 101, 102, 104, 106, 108, 110, 112, 114, 116, 118,
  122, 124, 126, 128, 130, 132, 134, 136, 138, 140, 143, 145, 148, 151, 154, 157,
);

/** ac_qlookup (RFC 6386 §14.1). */
const AC_QUANT = Uint16Array.of(
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
  20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35,
  36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51,
  52, 53, 54, 55, 56, 57, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76,
  78, 80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 100, 102, 104, 106, 108,
  110, 112, 114, 116, 119, 122, 125, 128, 131, 134, 137, 140, 143, 146, 149, 152,
  155, 158, 161, 164, 167, 170, 173, 177, 181, 185, 189, 193, 197, 201, 205, 209,
  213, 217, 221, 225, 229, 234, 239, 245, 249, 254, 259, 264, 269, 274, 279, 284,
);

/**
 * The boolean entropy decoder of RFC 6386 §7. `value` holds a two-byte window; reading past the end of
 * the partition shifts in zeros exactly as the reference decoder does.
 */
class BoolDecoder {
  private data: Uint8Array = new Uint8Array(0);
  private pos = 0;
  private end = 0;
  private value = 0;
  private range = 255;
  private bitCount = 0;

  init(data: Uint8Array, start: number, end: number): void {
    this.data = data;
    this.pos = start;
    this.end = end;
    this.range = 255;
    this.bitCount = 0;
    this.value = this.nextByte() << 8;
    this.value |= this.nextByte();
  }

  private nextByte(): number {
    return this.pos < this.end ? (this.data[this.pos++] as number) : 0;
  }

  readBool(prob: number): number {
    const split = 1 + (((this.range - 1) * prob) >> 8);
    const bigSplit = split << 8;
    let bit: number;
    if (this.value >= bigSplit) {
      this.range -= split;
      this.value -= bigSplit;
      bit = 1;
    } else {
      this.range = split;
      bit = 0;
    }
    if (this.range < 128) {
      // Shift until the range is back in [128, 255]; at most seven bits, so at most one new byte.
      const shift = Math.clz32(this.range) - 24;
      this.range <<= shift;
      this.value <<= shift;
      this.bitCount += shift;
      if (this.bitCount >= 8) {
        this.bitCount -= 8;
        this.value |= this.nextByte() << this.bitCount;
      }
    }
    return bit;
  }

  readLiteral(bits: number): number {
    let v = 0;
    for (let i = 0; i < bits; i++) v = (v << 1) | this.readBool(128);
    return v;
  }

  /** A magnitude of `bits` bits followed by a sign flag. */
  readSigned(bits: number): number {
    const v = this.readLiteral(bits);
    return this.readBool(128) ? -v : v;
  }

  /** An optional signed field: a presence flag, then readSigned (absent reads as 0). */
  readOptionalSigned(bits: number): number {
    return this.readBool(128) ? this.readSigned(bits) : 0;
  }

  readTree(tree: Int8Array, probs: Uint8Array, probOffset: number): number {
    let i = 0;
    while ((i = tree[i + this.readBool(probs[probOffset + (i >> 1)] as number)] as number) > 0);
    return 0 - i;
  }
}

/** Per-frame values from the first partition's header (RFC 6386 §9.2–9.11, §19.2). */
interface FrameHeader {
  useSegment: boolean;
  updateSegmentMap: boolean;
  segmentProbs: Uint8Array;
  simpleFilter: boolean;
  filterLevel: number;
  sharpness: number;
  /** Final loop-filter level per segment and luma mode class: index segment * 2 + (B_PRED ? 1 : 0). */
  mbFilterLevels: Uint8Array;
  partitionCount: number;
  /** Dequantization factors per segment: y1dc, y1ac, y2dc, y2ac, uvdc, uvac. */
  quant: Int32Array;
  coeffProbs: Uint8Array;
  useSkipProb: boolean;
  skipProb: number;
}

const clampInt = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function readFrameHeader(br: BoolDecoder): FrameHeader {
  br.readBool(128); // color_space: only YUV is defined, and libwebp ignores it as well
  br.readBool(128); // clamping_type: reconstruction always clamps, which is valid for either value

  const useSegment = br.readBool(128) === 1;
  let updateSegmentMap = false;
  let absoluteSegmentValues = true;
  const segmentQuant = new Int32Array(4);
  const segmentFilter = new Int32Array(4);
  const segmentProbs = Uint8Array.of(255, 255, 255);
  if (useSegment) {
    updateSegmentMap = br.readBool(128) === 1;
    if (br.readBool(128)) {
      absoluteSegmentValues = br.readBool(128) === 1;
      for (let s = 0; s < 4; s++) segmentQuant[s] = br.readOptionalSigned(7);
      for (let s = 0; s < 4; s++) segmentFilter[s] = br.readOptionalSigned(6);
    }
    if (updateSegmentMap) {
      for (let i = 0; i < 3; i++) segmentProbs[i] = br.readBool(128) ? br.readLiteral(8) : 255;
    }
  }

  const simpleFilter = br.readBool(128) === 1;
  const filterLevel = br.readLiteral(6);
  const sharpness = br.readLiteral(3);
  let refDelta = 0;
  let bPredDelta = 0;
  const useLfDelta = br.readBool(128) === 1;
  if (useLfDelta && br.readBool(128)) {
    // Only the intra-frame reference delta and the B_PRED mode delta can apply to a key frame, but all
    // eight fields must be read to stay in sync.
    for (let i = 0; i < 4; i++) {
      const delta = br.readOptionalSigned(6);
      if (i === 0) refDelta = delta;
    }
    for (let i = 0; i < 4; i++) {
      const delta = br.readOptionalSigned(6);
      if (i === 0) bPredDelta = delta;
    }
  }

  const partitionCount = 1 << br.readLiteral(2);

  const baseQ = br.readLiteral(7);
  const y1DcDelta = br.readOptionalSigned(4);
  const y2DcDelta = br.readOptionalSigned(4);
  const y2AcDelta = br.readOptionalSigned(4);
  const uvDcDelta = br.readOptionalSigned(4);
  const uvAcDelta = br.readOptionalSigned(4);
  const quant = new Int32Array(4 * 6);
  for (let s = 0; s < 4; s++) {
    const q = useSegment ? segmentQuant[s]! + (absoluteSegmentValues ? 0 : baseQ) : baseQ;
    const o = s * 6;
    quant[o] = DC_QUANT[clampInt(q + y1DcDelta, 0, 127)]!;
    quant[o + 1] = AC_QUANT[clampInt(q, 0, 127)]!;
    quant[o + 2] = DC_QUANT[clampInt(q + y2DcDelta, 0, 127)]! * 2;
    quant[o + 3] = Math.max(8, Math.floor((AC_QUANT[clampInt(q + y2AcDelta, 0, 127)]! * 155) / 100));
    quant[o + 4] = Math.min(132, DC_QUANT[clampInt(q + uvDcDelta, 0, 127)]!);
    quant[o + 5] = AC_QUANT[clampInt(q + uvAcDelta, 0, 127)]!;
  }

  const mbFilterLevels = new Uint8Array(8);
  for (let s = 0; s < 4; s++) {
    const base = useSegment ? segmentFilter[s]! + (absoluteSegmentValues ? 0 : filterLevel) : filterLevel;
    for (let bPred = 0; bPred < 2; bPred++) {
      let level = base;
      if (useLfDelta) {
        level += refDelta;
        if (bPred) level += bPredDelta;
      }
      mbFilterLevels[s * 2 + bPred] = clampInt(level, 0, 63);
    }
  }

  br.readBool(128); // refresh_entropy_probs: irrelevant for a single frame

  const coeffProbs = DEFAULT_COEFF_PROBS.slice();
  for (let i = 0; i < COEFF_PROB_COUNT; i++) {
    if (br.readBool(COEFF_UPDATE_PROBS[i]!)) coeffProbs[i] = br.readLiteral(8);
  }

  const useSkipProb = br.readBool(128) === 1;
  const skipProb = useSkipProb ? br.readLiteral(8) : 0;

  return {
    useSegment,
    updateSegmentMap,
    segmentProbs,
    simpleFilter,
    filterLevel,
    sharpness,
    mbFilterLevels,
    partitionCount,
    quant,
    coeffProbs,
    useSkipProb,
    skipProb,
  };
}

/** Reads the VP8 key-frame header from a 'VP8 ' chunk payload. Returns null if it is not a valid key frame header. */
export function readVp8Header(data: Uint8Array): Vp8Header | null {
  if (data.length < FRAME_HEADER_BYTES) return null;
  const tag = data[0]! | (data[1]! << 8) | (data[2]! << 16);
  if ((tag & 1) !== 0) return null;
  if (((tag >> 1) & 7) > 3) return null;
  if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) return null;
  return { width: (data[6]! | (data[7]! << 8)) & 0x3fff, height: (data[8]! | (data[9]! << 8)) & 0x3fff };
}

/**
 * Reads one block's tokens (RFC 6386 §13) into `out[off..off+16)` in raster order, dequantized.
 * Returns the position after the last token read (the libwebp/libvpx "eob"): `first` for an empty
 * block, 16 when the block ran to its end.
 */
function readCoefficients(
  br: BoolDecoder,
  probs: Uint8Array,
  type: number,
  ctx: number,
  first: number,
  dcFactor: number,
  acFactor: number,
  out: Int16Array,
  off: number,
): number {
  const typeBase = type * NUM_BANDS * NUM_CONTEXTS * NUM_TOKEN_PROBS;
  let n = first;
  let p = typeBase + BAND_OFFSET[n]! + ctx * NUM_TOKEN_PROBS;
  while (n < 16) {
    if (!br.readBool(probs[p]!)) return n; // end of block
    while (!br.readBool(probs[p + 1]!)) {
      // DCT_0: the next token cannot be an end of block, so its tree starts at the second node.
      if (++n === 16) return 16;
      p = typeBase + BAND_OFFSET[n]!;
    }
    let v: number;
    let nextCtx: number;
    if (!br.readBool(probs[p + 2]!)) {
      v = 1;
      nextCtx = 1;
    } else {
      nextCtx = 2;
      if (!br.readBool(probs[p + 3]!)) {
        if (!br.readBool(probs[p + 4]!)) v = 2;
        else v = 3 + br.readBool(probs[p + 5]!);
      } else {
        let cat: number;
        if (!br.readBool(probs[p + 6]!)) cat = br.readBool(probs[p + 7]!);
        else if (!br.readBool(probs[p + 8]!)) cat = 2 + br.readBool(probs[p + 9]!);
        else cat = 4 + br.readBool(probs[p + 10]!);
        const extra = CAT_PROBS[cat]!;
        let bits = 0;
        for (let i = 0; i < extra.length; i++) bits = (bits << 1) | br.readBool(extra[i]!);
        v = CAT_BASE[cat]! + bits;
      }
    }
    if (br.readBool(128)) v = -v;
    // Stored as 16-bit like the reference decoders; only hostile streams can exceed that range.
    out[off + ZIGZAG[n]!] = v * (n > 0 ? acFactor : dcFactor);
    if (++n === 16) return 16;
    p = typeBase + BAND_OFFSET[n]! + nextCtx * NUM_TOKEN_PROBS;
  }
  return n;
}

/** Inverse Walsh-Hadamard transform of the Y2 block (RFC 6386 §14.3); output DCs go to each Y block's slot 0. */
function inverseWht(coeffs: Int16Array, inOff: number, tmp: Int32Array): void {
  for (let i = 0; i < 4; i++) {
    const i0 = coeffs[inOff + i]!;
    const i1 = coeffs[inOff + 4 + i]!;
    const i2 = coeffs[inOff + 8 + i]!;
    const i3 = coeffs[inOff + 12 + i]!;
    const a1 = i0 + i3;
    const b1 = i1 + i2;
    const c1 = i1 - i2;
    const d1 = i0 - i3;
    tmp[i] = a1 + b1;
    tmp[4 + i] = c1 + d1;
    tmp[8 + i] = a1 - b1;
    tmp[12 + i] = d1 - c1;
  }
  for (let i = 0; i < 4; i++) {
    const r = i * 4;
    const a1 = tmp[r]! + tmp[r + 3]!;
    const b1 = tmp[r + 1]! + tmp[r + 2]!;
    const c1 = tmp[r + 1]! - tmp[r + 2]!;
    const d1 = tmp[r]! - tmp[r + 3]!;
    coeffs[(r + 0) * 16] = (a1 + b1 + 3) >> 3;
    coeffs[(r + 1) * 16] = (c1 + d1 + 3) >> 3;
    coeffs[(r + 2) * 16] = (a1 - b1 + 3) >> 3;
    coeffs[(r + 3) * 16] = (d1 - c1 + 3) >> 3;
  }
}

// x * sqrt(2) * cos(pi / 8) and x * sqrt(2) * sin(pi / 8) in 16-bit fixed point (RFC 6386 §14.4).
const mulCos = (x: number): number => x + ((x * 20091) >> 16);
const mulSin = (x: number): number => (x * 35468) >> 16;

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Inverse DCT of one 4x4 block (RFC 6386 §14.4), added to the prediction already in the plane. */
function inverseDctAdd(coeffs: Int16Array, off: number, plane: Uint8Array, pos: number, stride: number, tmp: Int32Array): void {
  for (let i = 0; i < 4; i++) {
    const i0 = coeffs[off + i]!;
    const i1 = coeffs[off + 4 + i]!;
    const i2 = coeffs[off + 8 + i]!;
    const i3 = coeffs[off + 12 + i]!;
    const a1 = i0 + i2;
    const b1 = i0 - i2;
    const c1 = mulSin(i1) - mulCos(i3);
    const d1 = mulCos(i1) + mulSin(i3);
    tmp[i] = a1 + d1;
    tmp[12 + i] = a1 - d1;
    tmp[4 + i] = b1 + c1;
    tmp[8 + i] = b1 - c1;
  }
  for (let r = 0; r < 4; r++) {
    const t = r * 4;
    const a1 = tmp[t]! + tmp[t + 2]!;
    const b1 = tmp[t]! - tmp[t + 2]!;
    const c1 = mulSin(tmp[t + 1]!) - mulCos(tmp[t + 3]!);
    const d1 = mulCos(tmp[t + 1]!) + mulSin(tmp[t + 3]!);
    const row = pos + r * stride;
    plane[row] = clamp255(plane[row]! + ((a1 + d1 + 4) >> 3));
    plane[row + 1] = clamp255(plane[row + 1]! + ((b1 + c1 + 4) >> 3));
    plane[row + 2] = clamp255(plane[row + 2]! + ((b1 - c1 + 4) >> 3));
    plane[row + 3] = clamp255(plane[row + 3]! + ((a1 - d1 + 4) >> 3));
  }
}

function blockIsZero(coeffs: Int16Array, off: number): boolean {
  for (let i = 0; i < 16; i++) if (coeffs[off + i] !== 0) return false;
  return true;
}

/**
 * Edge samples for prediction of a size x size block at (x, y) of a plane (RFC 6386 §12.2): the row
 * above reads 127 on the frame's top edge, the column to the left 129 on its left edge, and the corner
 * follows the row above (127) on the top edge and the left column (129) otherwise.
 */
function loadEdges(plane: Uint8Array, stride: number, x: number, y: number, size: number, above: Int32Array, left: Int32Array): number {
  for (let i = 0; i < size; i++) {
    above[i] = y === 0 ? 127 : plane[(y - 1) * stride + x + i]!;
    left[i] = x === 0 ? 129 : plane[(y + i) * stride + x - 1]!;
  }
  return y === 0 ? 127 : x === 0 ? 129 : plane[(y - 1) * stride + x - 1]!;
}

/** 16x16 luma or 8x8 chroma prediction (RFC 6386 §12.2) written into the plane. */
function predictBlock(
  mode: number,
  plane: Uint8Array,
  stride: number,
  x: number,
  y: number,
  size: number,
  above: Int32Array,
  left: Int32Array,
): void {
  const corner = loadEdges(plane, stride, x, y, size, above, left);
  const shift = size === 16 ? 4 : 3;
  const base = y * stride + x;
  if (mode === DC_PRED) {
    let sum = 0;
    let dc = 128;
    if (x > 0 && y > 0) {
      for (let i = 0; i < size; i++) sum += above[i]! + left[i]!;
      dc = (sum + size) >> (shift + 1);
    } else if (y > 0) {
      for (let i = 0; i < size; i++) sum += above[i]!;
      dc = (sum + (size >> 1)) >> shift;
    } else if (x > 0) {
      for (let i = 0; i < size; i++) sum += left[i]!;
      dc = (sum + (size >> 1)) >> shift;
    }
    for (let r = 0; r < size; r++) plane.fill(dc, base + r * stride, base + r * stride + size);
  } else if (mode === V_PRED) {
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) plane[base + r * stride + c] = above[c]!;
  } else if (mode === H_PRED) {
    for (let r = 0; r < size; r++) plane.fill(left[r]!, base + r * stride, base + r * stride + size);
  } else {
    for (let r = 0; r < size; r++) {
      const l = left[r]! - corner;
      for (let c = 0; c < size; c++) plane[base + r * stride + c] = clamp255(l + above[c]!);
    }
  }
}

const avg2 = (a: number, b: number): number => (a + b + 1) >> 1;
const avg3 = (a: number, b: number, c: number): number => (a + 2 * b + c + 2) >> 2;

/**
 * 4x4 subblock prediction (RFC 6386 §12.3). `e` is the edge array of the RFC: e[0..3] the left column
 * bottom to top, e[4] the corner, e[5..12] the eight pixels above (four of them above-right).
 */
function predictSubblock(mode: number, e: Int32Array, plane: Uint8Array, pos: number, stride: number, b: Int32Array): void {
  // A[i] = e[5 + i] (A[-1] = e[4]); L[i] = e[3 - i].
  switch (mode) {
    case B_DC_PRED: {
      let sum = 4;
      for (let i = 0; i < 4; i++) sum += e[5 + i]! + e[3 - i]!;
      b.fill(sum >> 3);
      break;
    }
    case B_TM_PRED:
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) b[r * 4 + c] = clamp255(e[3 - r]! + e[5 + c]! - e[4]!);
      break;
    case B_VE_PRED:
      for (let c = 0; c < 4; c++) {
        const v = avg3(e[4 + c]!, e[5 + c]!, e[6 + c]!);
        b[c] = b[4 + c] = b[8 + c] = b[12 + c] = v;
      }
      break;
    case B_HE_PRED: {
      // Row r smooths L[r - 1], L[r], L[r + 1] with L[-1] the corner; the bottom row repeats L[3].
      b.fill(avg3(e[4]!, e[3]!, e[2]!), 0, 4);
      b.fill(avg3(e[3]!, e[2]!, e[1]!), 4, 8);
      b.fill(avg3(e[2]!, e[1]!, e[0]!), 8, 12);
      b.fill(avg3(e[1]!, e[0]!, e[0]!), 12, 16);
      break;
    }
    case B_LD_PRED:
      // Down-left diagonals from the row above: pixel (r, c) uses A[r + c .. r + c + 2], A[8] := A[7].
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const i = 5 + r + c;
          b[r * 4 + c] = r + c === 6 ? avg3(e[11]!, e[12]!, e[12]!) : avg3(e[i]!, e[i + 1]!, e[i + 2]!);
        }
      }
      break;
    case B_RD_PRED:
      // Down-right diagonals through the corner: pixel (r, c) is centred on e[4 - r + c].
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const i = 4 - r + c;
          b[r * 4 + c] = avg3(e[i - 1]!, e[i]!, e[i + 1]!);
        }
      }
      break;
    case B_VR_PRED:
      b[12] = avg3(e[1]!, e[2]!, e[3]!);
      b[8] = avg3(e[2]!, e[3]!, e[4]!);
      b[13] = b[4] = avg3(e[3]!, e[4]!, e[5]!);
      b[9] = b[0] = avg2(e[4]!, e[5]!);
      b[14] = b[5] = avg3(e[4]!, e[5]!, e[6]!);
      b[10] = b[1] = avg2(e[5]!, e[6]!);
      b[15] = b[6] = avg3(e[5]!, e[6]!, e[7]!);
      b[11] = b[2] = avg2(e[6]!, e[7]!);
      b[7] = avg3(e[6]!, e[7]!, e[8]!);
      b[3] = avg2(e[7]!, e[8]!);
      break;
    case B_VL_PRED:
      b[0] = avg2(e[5]!, e[6]!);
      b[4] = avg3(e[5]!, e[6]!, e[7]!);
      b[8] = b[1] = avg2(e[6]!, e[7]!);
      b[5] = b[12] = avg3(e[6]!, e[7]!, e[8]!);
      b[9] = b[2] = avg2(e[7]!, e[8]!);
      b[13] = b[6] = avg3(e[7]!, e[8]!, e[9]!);
      b[10] = b[3] = avg2(e[8]!, e[9]!);
      b[14] = b[7] = avg3(e[8]!, e[9]!, e[10]!);
      b[11] = avg3(e[9]!, e[10]!, e[11]!);
      b[15] = avg3(e[10]!, e[11]!, e[12]!);
      break;
    case B_HD_PRED:
      b[12] = avg2(e[0]!, e[1]!);
      b[13] = avg3(e[0]!, e[1]!, e[2]!);
      b[8] = b[14] = avg2(e[1]!, e[2]!);
      b[9] = b[15] = avg3(e[1]!, e[2]!, e[3]!);
      b[10] = b[4] = avg2(e[2]!, e[3]!);
      b[11] = b[5] = avg3(e[2]!, e[3]!, e[4]!);
      b[6] = b[0] = avg2(e[3]!, e[4]!);
      b[7] = b[1] = avg3(e[3]!, e[4]!, e[5]!);
      b[2] = avg3(e[4]!, e[5]!, e[6]!);
      b[3] = avg3(e[5]!, e[6]!, e[7]!);
      break;
    default: {
      // B_HU_PRED, from the left column: L[0] = e[3] .. L[3] = e[0].
      b[0] = avg2(e[3]!, e[2]!);
      b[1] = avg3(e[3]!, e[2]!, e[1]!);
      b[2] = b[4] = avg2(e[2]!, e[1]!);
      b[3] = b[5] = avg3(e[2]!, e[1]!, e[0]!);
      b[6] = b[8] = avg2(e[1]!, e[0]!);
      b[7] = b[9] = avg3(e[1]!, e[0]!, e[0]!);
      b[10] = b[11] = b[12] = b[13] = b[14] = b[15] = e[0]!;
      break;
    }
  }
  for (let r = 0; r < 4; r++) {
    const row = pos + r * stride;
    for (let c = 0; c < 4; c++) plane[row + c] = b[r * 4 + c]!;
  }
}

// Loop filters (RFC 6386 §15). Pixels are handled in the signed domain v - 128; `step` crosses the edge,
// `pitch` walks along it.
const s8 = (v: number): number => (v < -128 ? -128 : v > 127 ? 127 : v);
const u8 = (v: number): number => (v < -128 ? 0 : v > 127 ? 255 : v + 128);

/** common_adjust (§15.2): moves p0 and q0 towards each other; returns the q0 adjustment. */
function commonAdjust(useOuterTaps: boolean, plane: Uint8Array, at: number, step: number): number {
  const p1 = plane[at - 2 * step]! - 128;
  const p0 = plane[at - step]! - 128;
  const q0 = plane[at]! - 128;
  const q1 = plane[at + step]! - 128;
  const a = s8((useOuterTaps ? s8(p1 - q1) : 0) + 3 * (q0 - p0));
  const b = s8(a + 3) >> 3;
  const f = s8(a + 4) >> 3;
  plane[at] = u8(q0 - f);
  plane[at - step] = u8(p0 + b);
  return f;
}

function simpleEdge(plane: Uint8Array, at: number, step: number, pitch: number, count: number, edgeLimit: number): void {
  for (let i = 0; i < count; i++, at += pitch) {
    const p1 = plane[at - 2 * step]!;
    const p0 = plane[at - step]!;
    const q0 = plane[at]!;
    const q1 = plane[at + step]!;
    if (Math.abs(p0 - q0) * 2 + (Math.abs(p1 - q1) >> 1) <= edgeLimit) commonAdjust(true, plane, at, step);
  }
}

function normalEdge(
  plane: Uint8Array,
  at: number,
  step: number,
  pitch: number,
  count: number,
  edgeLimit: number,
  interiorLimit: number,
  hevThreshold: number,
  macroblockEdge: boolean,
): void {
  for (let i = 0; i < count; i++, at += pitch) {
    const p3 = plane[at - 4 * step]!;
    const p2 = plane[at - 3 * step]!;
    const p1 = plane[at - 2 * step]!;
    const p0 = plane[at - step]!;
    const q0 = plane[at]!;
    const q1 = plane[at + step]!;
    const q2 = plane[at + 2 * step]!;
    const q3 = plane[at + 3 * step]!;
    if (
      Math.abs(p0 - q0) * 2 + (Math.abs(p1 - q1) >> 1) > edgeLimit ||
      Math.abs(p3 - p2) > interiorLimit ||
      Math.abs(p2 - p1) > interiorLimit ||
      Math.abs(p1 - p0) > interiorLimit ||
      Math.abs(q3 - q2) > interiorLimit ||
      Math.abs(q2 - q1) > interiorLimit ||
      Math.abs(q1 - q0) > interiorLimit
    ) {
      continue;
    }
    const highVariance = Math.abs(p1 - p0) > hevThreshold || Math.abs(q1 - q0) > hevThreshold;
    if (highVariance) {
      commonAdjust(true, plane, at, step);
    } else if (macroblockEdge) {
      const w = s8(s8(p1 - q1) + 3 * (q0 - p0));
      let a = s8((27 * w + 63) >> 7);
      plane[at] = u8(q0 - 128 - a);
      plane[at - step] = u8(p0 - 128 + a);
      a = s8((18 * w + 63) >> 7);
      plane[at + step] = u8(q1 - 128 - a);
      plane[at - 2 * step] = u8(p1 - 128 + a);
      a = s8((9 * w + 63) >> 7);
      plane[at + 2 * step] = u8(q2 - 128 - a);
      plane[at - 3 * step] = u8(p2 - 128 + a);
    } else {
      const a = (commonAdjust(false, plane, at, step) + 1) >> 1;
      plane[at + step] = u8(q1 - 128 - a);
      plane[at - 2 * step] = u8(p1 - 128 + a);
    }
  }
}

/**
 * libwebp's YUV to RGB conversion: BT.601 studio-swing coefficients in 14-bit fixed point
 * (1.164 * 2^14 = 19077, 1.596 * 2^14 = 26149, 0.391 * 2^14 = 6419, 0.813 * 2^14 = 13320,
 * 2.018 * 2^14 = 33050), each product reduced to 6 fractional bits, with the -16 / -128 offsets and
 * the rounding half folded into one constant per channel.
 */
const mulHi = (v: number, coeff: number): number => (v * coeff) >> 8;
const clipRgb = (v: number): number => ((v & ~16383) === 0 ? v >> 6 : v < 0 ? 0 : 255);

/** (9a + 3b + 3c + d) / 16 as libwebp rounds it: an average of the diagonal blend and the near sample. */
const fancy = (a: number, b: number, c: number, d: number): number => ((((a + b + c + d + 8 + 2 * (b + c)) >> 3) + a) >> 1);

/**
 * Converts one output row with libwebp's "fancy" chroma upsampling: each pixel gets a 9-3-3-1
 * weighting of the nearest chroma sample, its horizontal and vertical neighbours on the pixel's side,
 * and the diagonal one; the first column (and the last of an even width) only blends vertically.
 * `nearRow`/`farRow` are offsets of the chroma rows on this side of and across the half-pixel boundary.
 */
function upsampleRow(
  y: Uint8Array,
  yRow: number,
  u: Uint8Array,
  v: Uint8Array,
  nearRow: number,
  farRow: number,
  width: number,
  out: Uint8Array,
  outRow: number,
): void {
  for (let x = 0; x < width; x++) {
    let cu: number;
    let cv: number;
    if (x === 0 || (x === width - 1 && (width & 1) === 0)) {
      // Left edge, and the right edge of an even width: vertical interpolation only.
      const c = x >> 1;
      cu = (3 * u[nearRow + c]! + u[farRow + c]! + 2) >> 2;
      cv = (3 * v[nearRow + c]! + v[farRow + c]! + 2) >> 2;
    } else {
      // Odd x sits right of chroma column (x - 1) / 2, even x left of column x / 2.
      const nearCol = (x & 1) === 1 ? (x - 1) >> 1 : x >> 1;
      const farCol = (x & 1) === 1 ? nearCol + 1 : nearCol - 1;
      cu = fancy(u[nearRow + nearCol]!, u[nearRow + farCol]!, u[farRow + nearCol]!, u[farRow + farCol]!);
      cv = fancy(v[nearRow + nearCol]!, v[nearRow + farCol]!, v[farRow + nearCol]!, v[farRow + farCol]!);
    }
    const luma = mulHi(y[yRow + x]!, 19077);
    const o = outRow + x * 4;
    out[o] = clipRgb(luma + mulHi(cv, 26149) - 14234);
    out[o + 1] = clipRgb(luma - mulHi(cu, 6419) - mulHi(cv, 13320) + 8708);
    out[o + 2] = clipRgb(luma + mulHi(cu, 33050) - 17685);
    out[o + 3] = 255;
  }
}

/**
 * Decodes a whole 'VP8 ' chunk payload into RGBA (alpha 255), width * height * 4 bytes, row-major from
 * the top left. Throws EmoteDecodeError: 'over-budget' when a side exceeds maxSide (before allocating),
 * 'corrupt' for bad header fields or partitions outside the data, 'unsupported' for a non-key frame.
 */
export function decodeVp8(data: Uint8Array, maxSide: number): { width: number; height: number; rgba: Uint8Array } {
  if (data.length < 3) throw corrupt('The VP8 frame tag is truncated.');
  const tag = data[0]! | (data[1]! << 8) | (data[2]! << 16);
  if ((tag & 1) !== 0) throw unsupported('The VP8 frame is an inter frame; WebP stores only key frames.');
  if (((tag >> 1) & 7) > 3) throw corrupt('The VP8 frame has an unknown version.');
  if (((tag >> 4) & 1) === 0) throw unsupported('The VP8 frame is marked as not shown.');
  const firstPartitionSize = tag >>> 5;
  const header = readVp8Header(data);
  if (header === null) throw corrupt('The VP8 key frame header is truncated or has a bad start code.');
  const { width, height } = header;
  if (width === 0 || height === 0) throw corrupt('The VP8 frame has an empty size.');
  if (width > maxSide || height > maxSide) throw overBudget(`The VP8 frame is ${width}x${height}, over the ${maxSide} pixel limit.`);

  const firstStart = FRAME_HEADER_BYTES;
  const firstEnd = firstStart + firstPartitionSize;
  if (firstEnd > data.length) throw corrupt('The VP8 first partition runs past the end of the data.');

  const br = new BoolDecoder();
  br.init(data, firstStart, firstEnd);
  const hdr = readFrameHeader(br);

  // Token partitions: a table of 3-byte little-endian sizes for all but the last, which takes the rest.
  const partitionCount = hdr.partitionCount;
  const sizesStart = firstEnd;
  let partStart = sizesStart + 3 * (partitionCount - 1);
  if (partStart > data.length) throw corrupt('The VP8 partition size table runs past the end of the data.');
  const tokenDecoders: BoolDecoder[] = [];
  for (let i = 0; i < partitionCount; i++) {
    let partEnd: number;
    if (i < partitionCount - 1) {
      const s = sizesStart + 3 * i;
      partEnd = partStart + (data[s]! | (data[s + 1]! << 8) | (data[s + 2]! << 16));
      if (partEnd > data.length) throw corrupt(`VP8 token partition ${i} runs past the end of the data.`);
    } else {
      partEnd = data.length;
      if (partEnd <= partStart) throw corrupt('The last VP8 token partition is empty.');
    }
    const td = new BoolDecoder();
    td.init(data, partStart, partEnd);
    tokenDecoders.push(td);
    partStart = partEnd;
  }

  const mbW = (width + 15) >> 4;
  const mbH = (height + 15) >> 4;
  const yStride = mbW * 16;
  const uvStride = mbW * 8;
  const yPlane = new Uint8Array(yStride * mbH * 16);
  const uPlane = new Uint8Array(uvStride * mbH * 8);
  const vPlane = new Uint8Array(uvStride * mbH * 8);

  // Contexts carried between macroblocks.
  const bmodeAbove = new Uint8Array(mbW * 4);
  const bmodeLeft = new Uint8Array(4);
  const nzAbove = new Uint8Array(mbW * 9); // per macroblock column: 4 Y, 2 U, 2 V, 1 Y2
  const nzLeft = new Uint8Array(9);
  const mbFilterLevel = new Uint8Array(mbW * mbH);
  const mbFilterInner = new Uint8Array(mbW * mbH);

  // Per-macroblock scratch, reused.
  const coeffs = new Int16Array(25 * 16);
  const bmodes = new Uint8Array(16);
  const tmp = new Int32Array(16);
  const above = new Int32Array(16);
  const left = new Int32Array(16);
  const edge = new Int32Array(13);
  const sub = new Int32Array(16);
  const probs = hdr.coeffProbs;

  for (let mbY = 0; mbY < mbH; mbY++) {
    bmodeLeft.fill(B_DC_PRED);
    nzLeft.fill(0);
    const tokens = tokenDecoders[mbY & (partitionCount - 1)]!;
    for (let mbX = 0; mbX < mbW; mbX++) {
      // Macroblock header (first partition, RFC 6386 §19.3).
      const segment = hdr.updateSegmentMap ? br.readTree(SEGMENT_TREE, hdr.segmentProbs, 0) : 0;
      const skip = hdr.useSkipProb ? br.readBool(hdr.skipProb) === 1 : false;
      let yMode: number;
      if (!br.readBool(KF_YMODE_PROBS[0]!)) yMode = B_PRED;
      else if (!br.readBool(KF_YMODE_PROBS[1]!)) yMode = br.readBool(KF_YMODE_PROBS[2]!) ? V_PRED : DC_PRED;
      else yMode = br.readBool(KF_YMODE_PROBS[3]!) ? TM_PRED : H_PRED;
      if (yMode === B_PRED) {
        for (let i = 0; i < 16; i++) {
          const col = mbX * 4 + (i & 3);
          const a = bmodeAbove[col]!;
          const l = bmodeLeft[i >> 2]!;
          const mode = br.readTree(BMODE_TREE, KF_BMODE_PROBS, (a * NUM_BMODES + l) * (NUM_BMODES - 1));
          bmodes[i] = mode;
          bmodeAbove[col] = mode;
          bmodeLeft[i >> 2] = mode;
        }
      } else {
        const implied = IMPLIED_BMODE[yMode]!;
        bmodeAbove.fill(implied, mbX * 4, mbX * 4 + 4);
        bmodeLeft.fill(implied);
      }
      let uvMode: number;
      if (!br.readBool(KF_UV_MODE_PROBS[0]!)) uvMode = DC_PRED;
      else if (!br.readBool(KF_UV_MODE_PROBS[1]!)) uvMode = V_PRED;
      else uvMode = br.readBool(KF_UV_MODE_PROBS[2]!) ? TM_PRED : H_PRED;

      // Residual tokens (RFC 6386 §13).
      coeffs.fill(0);
      const hasY2 = yMode !== B_PRED;
      const nzA = mbX * 9;
      let nonZero = false;
      if (skip) {
        nzAbove.fill(0, nzA, nzA + 8);
        nzLeft.fill(0, 0, 8);
        if (hasY2) {
          nzAbove[nzA + 8] = 0;
          nzLeft[8] = 0;
        }
      } else {
        const q = segment * 6;
        let firstCoeff = 0;
        let yType = TYPE_Y_WITH_DC;
        if (hasY2) {
          const ctx = nzAbove[nzA + 8]! + nzLeft[8]!;
          const eob = readCoefficients(tokens, probs, TYPE_Y2, ctx, 0, hdr.quant[q + 2]!, hdr.quant[q + 3]!, coeffs, 24 * 16);
          const nz = eob > 0 ? 1 : 0;
          nzAbove[nzA + 8] = nz;
          nzLeft[8] = nz;
          inverseWht(coeffs, 24 * 16, tmp);
          firstCoeff = 1;
          yType = TYPE_Y_AFTER_Y2;
        }
        for (let i = 0; i < 16; i++) {
          const ax = nzA + (i & 3);
          const ly = i >> 2;
          const ctx = nzAbove[ax]! + nzLeft[ly]!;
          const eob = readCoefficients(tokens, probs, yType, ctx, firstCoeff, hdr.quant[q]!, hdr.quant[q + 1]!, coeffs, i * 16);
          const nz = eob > firstCoeff ? 1 : 0;
          nzAbove[ax] = nz;
          nzLeft[ly] = nz;
          if (eob > 1 || coeffs[i * 16] !== 0) nonZero = true;
        }
        for (let i = 16; i < 24; i++) {
          // U blocks 16..19 then V blocks 20..23, each a 2x2 grid.
          const j = i & 3;
          const plane = i < 20 ? 4 : 6;
          const ax = nzA + plane + (j & 1);
          const ly = plane + (j >> 1);
          const ctx = nzAbove[ax]! + nzLeft[ly]!;
          const eob = readCoefficients(tokens, probs, TYPE_UV, ctx, 0, hdr.quant[q + 4]!, hdr.quant[q + 5]!, coeffs, i * 16);
          const nz = eob > 0 ? 1 : 0;
          nzAbove[ax] = nz;
          nzLeft[ly] = nz;
          if (eob > 1 || coeffs[i * 16] !== 0) nonZero = true;
        }
      }

      // Reconstruction: prediction plus residue, on the unfiltered planes.
      const x0 = mbX * 16;
      const y0 = mbY * 16;
      if (yMode === B_PRED) {
        for (let i = 0; i < 16; i++) {
          const sx = x0 + (i & 3) * 4;
          const sy = y0 + (i >> 2) * 4;
          loadSubblockEdges(yPlane, yStride, sx, sy, i, mbX, mbW, x0, y0, edge);
          const pos = sy * yStride + sx;
          predictSubblock(bmodes[i]!, edge, yPlane, pos, yStride, sub);
          if (!blockIsZero(coeffs, i * 16)) inverseDctAdd(coeffs, i * 16, yPlane, pos, yStride, tmp);
        }
      } else {
        predictBlock(yMode, yPlane, yStride, x0, y0, 16, above, left);
        for (let i = 0; i < 16; i++) {
          if (blockIsZero(coeffs, i * 16)) continue;
          const pos = (y0 + (i >> 2) * 4) * yStride + x0 + (i & 3) * 4;
          inverseDctAdd(coeffs, i * 16, yPlane, pos, yStride, tmp);
        }
      }
      const cx = mbX * 8;
      const cy = mbY * 8;
      predictBlock(uvMode, uPlane, uvStride, cx, cy, 8, above, left);
      predictBlock(uvMode, vPlane, uvStride, cx, cy, 8, above, left);
      for (let i = 0; i < 4; i++) {
        const pos = (cy + (i >> 1) * 4) * uvStride + cx + (i & 1) * 4;
        if (!blockIsZero(coeffs, (16 + i) * 16)) inverseDctAdd(coeffs, (16 + i) * 16, uPlane, pos, uvStride, tmp);
        if (!blockIsZero(coeffs, (20 + i) * 16)) inverseDctAdd(coeffs, (20 + i) * 16, vPlane, pos, uvStride, tmp);
      }

      const mb = mbY * mbW + mbX;
      mbFilterLevel[mb] = hdr.mbFilterLevels[segment * 2 + (yMode === B_PRED ? 1 : 0)]!;
      mbFilterInner[mb] = yMode === B_PRED || nonZero ? 1 : 0;
    }
  }

  if (hdr.filterLevel > 0) {
    loopFilter(hdr, mbW, mbH, mbFilterLevel, mbFilterInner, yPlane, yStride, uPlane, vPlane, uvStride);
  }

  const rgba = new Uint8Array(width * height * 4);
  const chromaRows = (height + 1) >> 1;
  for (let row = 0; row < height; row++) {
    // Row 0 and the last row of an even height see a single chroma row; the others blend the chroma
    // row on their side (near) with the one across the half-pixel boundary (far).
    const k = (row + 1) >> 1;
    let near: number;
    let far: number;
    if (row === 0) {
      near = far = 0;
    } else if ((row & 1) === 1) {
      near = k - 1;
      far = Math.min(k, chromaRows - 1);
    } else {
      near = k;
      far = k - 1;
    }
    upsampleRow(yPlane, row * yStride, uPlane, vPlane, near * uvStride, far * uvStride, width, rgba, row * width * 4);
  }
  return { width, height, rgba };
}


/**
 * Gathers the 13 edge samples of luma subblock `i` (RFC 6386 §12.3). The four pixels above-right of
 * the subblocks in the macroblock's right column come from the macroblock row above (127 on the top
 * row; the last pixel repeated on the right edge), since the macroblock to the right is not decoded yet.
 */
function loadSubblockEdges(
  plane: Uint8Array,
  stride: number,
  sx: number,
  sy: number,
  i: number,
  mbX: number,
  mbW: number,
  x0: number,
  y0: number,
  e: Int32Array,
): void {
  for (let r = 0; r < 4; r++) e[3 - r] = sx === 0 ? 129 : plane[(sy + r) * stride + sx - 1]!;
  e[4] = sy === 0 ? 127 : sx === 0 ? 129 : plane[(sy - 1) * stride + sx - 1]!;
  for (let c = 0; c < 4; c++) e[5 + c] = sy === 0 ? 127 : plane[(sy - 1) * stride + sx + c]!;
  if ((i & 3) < 3) {
    for (let c = 4; c < 8; c++) e[5 + c] = sy === 0 ? 127 : plane[(sy - 1) * stride + sx + c]!;
  } else if (y0 === 0) {
    e.fill(127, 9, 13);
  } else if (mbX === mbW - 1) {
    e.fill(plane[(y0 - 1) * stride + x0 + 15]!, 9, 13);
  } else {
    for (let c = 0; c < 4; c++) e[9 + c] = plane[(y0 - 1) * stride + x0 + 16 + c]!;
  }
}

/** Applies the loop filter to the reconstructed frame, macroblock by macroblock in raster order (§15.1). */
function loopFilter(
  hdr: FrameHeader,
  mbW: number,
  mbH: number,
  levels: Uint8Array,
  inner: Uint8Array,
  yPlane: Uint8Array,
  yStride: number,
  uPlane: Uint8Array,
  vPlane: Uint8Array,
  uvStride: number,
): void {
  const sharpness = hdr.sharpness;
  for (let mbY = 0; mbY < mbH; mbY++) {
    for (let mbX = 0; mbX < mbW; mbX++) {
      const mb = mbY * mbW + mbX;
      const level = levels[mb]!;
      if (level === 0) continue;
      let interior = level;
      if (sharpness > 0) {
        interior >>= sharpness > 4 ? 2 : 1;
        if (interior > 9 - sharpness) interior = 9 - sharpness;
      }
      if (interior < 1) interior = 1;
      const hev = level >= 40 ? 2 : level >= 15 ? 1 : 0;
      const mbLimit = (level + 2) * 2 + interior;
      const subLimit = level * 2 + interior;
      const filterInner = inner[mb] === 1;
      const y = mbY * 16 * yStride + mbX * 16;
      const uv = mbY * 8 * uvStride + mbX * 8;

      if (hdr.simpleFilter) {
        if (mbX > 0) simpleEdge(yPlane, y, 1, yStride, 16, mbLimit);
        if (filterInner) for (let k = 4; k < 16; k += 4) simpleEdge(yPlane, y + k, 1, yStride, 16, subLimit);
        if (mbY > 0) simpleEdge(yPlane, y, yStride, 1, 16, mbLimit);
        if (filterInner) for (let k = 4; k < 16; k += 4) simpleEdge(yPlane, y + k * yStride, yStride, 1, 16, subLimit);
        continue;
      }

      if (mbX > 0) {
        normalEdge(yPlane, y, 1, yStride, 16, mbLimit, interior, hev, true);
        normalEdge(uPlane, uv, 1, uvStride, 8, mbLimit, interior, hev, true);
        normalEdge(vPlane, uv, 1, uvStride, 8, mbLimit, interior, hev, true);
      }
      if (filterInner) {
        for (let k = 4; k < 16; k += 4) normalEdge(yPlane, y + k, 1, yStride, 16, subLimit, interior, hev, false);
        normalEdge(uPlane, uv + 4, 1, uvStride, 8, subLimit, interior, hev, false);
        normalEdge(vPlane, uv + 4, 1, uvStride, 8, subLimit, interior, hev, false);
      }
      if (mbY > 0) {
        normalEdge(yPlane, y, yStride, 1, 16, mbLimit, interior, hev, true);
        normalEdge(uPlane, uv, uvStride, 1, 8, mbLimit, interior, hev, true);
        normalEdge(vPlane, uv, uvStride, 1, 8, mbLimit, interior, hev, true);
      }
      if (filterInner) {
        for (let k = 4; k < 16; k += 4) normalEdge(yPlane, y + k * yStride, yStride, 1, 16, subLimit, interior, hev, false);
        normalEdge(uPlane, uv + 4 * uvStride, uvStride, 1, 8, subLimit, interior, hev, false);
        normalEdge(vPlane, uv + 4 * uvStride, uvStride, 1, 8, subLimit, interior, hev, false);
      }
    }
  }
}
