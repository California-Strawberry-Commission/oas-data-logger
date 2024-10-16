#ifndef DLF_ENCODABLE_H
#define DLF_ENCODABLE_H

#include <Arduino.h>

#include "dlf_util.h"

// https://akrzemi1.wordpress.com/2013/10/10/too-perfect-forwarding/
class Encodable {
   public:
    const char *type_structure = nullptr;
    size_t type_hash = 0;
    uint8_t *data = nullptr;
    size_t data_size = 0;

    /**
     * NOTE: Must be `const T &` to allow copy-constructor to properly
     * overload. Const is cast away when initializing data on purpose.
     *
     * Without const, new Encodables are constructed with Encodable(encodable)
     * rather than copying.
     */
    // template <typename T>
    // Encodable(const T &v) : type_id(characteristic_type_name<T>()),
    //                         type_structure(get_structure_from_type_id(type_id)),
    //                         type_hash(hash_str(type_id)),
    //                         data((uint8_t *)&v),
    //                         data_size(sizeof(T)) {
    // }

    template <typename T>
    Encodable(T &v, const char *type_structure) : type_structure(type_structure),
                                                  type_hash(hash_str(type_structure)),
                                                  data((uint8_t *)(&v)),
                                                  data_size(sizeof(T)) {
    }
};

#endif