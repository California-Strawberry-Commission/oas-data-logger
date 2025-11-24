#pragma once

#include <Arduino.h>

#include "dlflib/util/util.h"

// https://akrzemi1.wordpress.com/2013/10/10/too-perfect-forwarding/
class Encodable {
 public:
  const char* type_structure = nullptr;
  size_t type_hash = 0;
  uint8_t* data = nullptr;
  size_t data_size = 0;

  template <typename T>
  Encodable(T& v, const char* type_structure)
      : type_structure(type_structure),
        type_hash(dlf::util::hashStr(type_structure)),
        data((uint8_t*)(&v)),
        data_size(sizeof(T)) {}
};
