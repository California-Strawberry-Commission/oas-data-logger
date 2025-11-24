#pragma once

namespace dlf::util {

// For a 32 bit int, returnVar must be of length 8 or greater.
inline void intToHex(const unsigned int inInt, char* returnVar) {
  const char* HEXMAP = "0123456789abcdef";
  for (int i = 0; i < 8; i++) {
    // Shift each hex digit to the right, and then map it to its corresponding
    // value
    returnVar[7 - i] = HEXMAP[(inInt >> (i * 4)) & 0b1111];
  }
}

// returnUUID must be of length 37 or greater
// (For the null terminator)
inline void uuidGen(char* returnUUID) {
  for (int i = 0; i < 4; i++) {
    unsigned int chunk = esp_random();
    // UUID4 requires a few bits to be specific values.
    if (i == 1) {
      chunk &= 0xFFFF0FFF;
      chunk |= 0x00004000;
    }
    if (i == 2) {
      chunk &= 0b00111111111111111111111111111111;
      chunk |= 0b10000000000000000000000000000000;
    }
    char chunkChars[8];
    intToHex(chunk, chunkChars);
    for (int p = 0; p < 8; p++) {
      returnUUID[p + 8 * i] = chunkChars[p];
    }
  }
  int dashOffset = 4;
  const int UUID_NUM_DIGITS = 32;
  for (int i = UUID_NUM_DIGITS - 1; i >= 0; i--) {
    if (i == 7 || i == 11 || i == 15 || i == 19)  // location of dashes
    {
      returnUUID[i + dashOffset--] = '-';
    }
    returnUUID[i + dashOffset] = returnUUID[i];
  }
  returnUUID[36] = 0;
}

inline String stringUuidGen() {
  char returnUUID[37];
  uuidGen(returnUUID);
  return String(returnUUID);
}

}  // namespace dlf::util