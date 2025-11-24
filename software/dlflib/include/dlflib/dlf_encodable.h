#pragma once

#include <Arduino.h>

#include "dlflib/util/util.h"

class Encodable {
 public:
  const char* typeStructure = nullptr;
  size_t typeHash = 0;
  uint8_t* data = nullptr;
  size_t dataSize = 0;

  template <typename T>
  Encodable(T& v, const char* typeStructure)
      : typeStructure(typeStructure),
        typeHash(dlf::util::hashStr(typeStructure)),
        data((uint8_t*)(&v)),
        dataSize(sizeof(T)) {}
};
