#pragma once

#include <vector>

#include "dlflib/components/component_registry.h"
#include "dlflib/util/util.h"

namespace dlf::components {

class Component {
 public:
  virtual ~Component() = default;

  void setRegistry(ComponentRegistry* registry) { registry_ = registry; }

  virtual bool begin() = 0;

  size_t id() const { return id_; }
  void setId(size_t id) { id_ = id; }

 protected:
  template <typename T>
  bool hasComponent() const {
    return getComponent<T>() != nullptr;
  }

  template <typename T>
  T* getComponent() const {
    if (!registry_) {
      return nullptr;
    }

    size_t id = dlf::util::hashType<T>();
    return static_cast<T*>(registry_->findById(id));
  }

 private:
  ComponentRegistry* registry_{nullptr};
  size_t id_{0};
};

}  // namespace dlf::components