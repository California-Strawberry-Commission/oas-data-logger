#pragma once

#include <vector>

#include "dlflib/utils/dlf_util.h"

namespace dlf::components {

class DlfComponent {
 public:
  void setup(std::vector<DlfComponent*>* componentStore) {
    componentStore_ = componentStore;
  }

  virtual bool begin() = 0;

 protected:
  virtual ~DlfComponent() = default;

  template <typename T>
  void addComponent(T* component) {
    if (!componentStore_) {
      return;
    }

    DlfComponent* dlfComponent = static_cast<DlfComponent*>(component);
    dlfComponent->id_ = hash_type<T>();
    componentStore_->push_back(dlfComponent);
  }

  template <typename T>
  bool hasComponent() {
    return getComponent<T>() != 0;
  }

  template <typename T>
  T* getComponent() {
    size_t h = hash_type<T>();
    for (auto component : *componentStore_) {
      if (component->id_ == h) {
        return static_cast<T*>(component);
      }
    }

    return nullptr;
  }

 private:
  std::vector<DlfComponent*>* componentStore_;
  size_t id_;
};

}  // namespace dlf::components