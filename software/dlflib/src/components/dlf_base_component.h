#pragma once

#include <vector>

#include "dlf_util.h"

class BaseComponent {
 public:
  void setup(std::vector<BaseComponent *> *store) { component_store = store; }

  virtual bool begin() = 0;

 protected:
  virtual ~BaseComponent() = default;

  BaseComponent(bool singleton = true) {}

  template <typename T>
  void add_component(T *c) {
    if (!component_store) {
      return;
    }

    BaseComponent *bc = static_cast<BaseComponent *>(c);
    bc->id = hash_type<T>();
    component_store->push_back(bc);
  }

  template <typename T>
  bool has_component() {
    return get_component<T>() != 0;
  }

  template <typename T>
  T *get_component() {
    size_t h = hash_type<T>();
    for (auto c : *component_store) {
      if (c->id == h) return static_cast<T *>(c);
    }

    return nullptr;
  }

 private:
  std::vector<BaseComponent *> *component_store;
  size_t id;
};