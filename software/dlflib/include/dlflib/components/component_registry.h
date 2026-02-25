#pragma once

#include <cstddef>

namespace dlf::components {

class Component;

class ComponentRegistry {
 public:
  virtual ~ComponentRegistry() {}
  virtual Component* findById(size_t id) const = 0;
};

}  // namespace dlf::components