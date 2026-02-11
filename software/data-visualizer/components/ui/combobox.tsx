"use client";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type Item = {
  value: string;
  label: string;
};

/**
 * Combobox can operate in two modes:
 *
 * 1) Controlled mode
 *    - Pass `value` and `onValueChange`
 *    - Parent is the single source of truth
 *
 *      <Combobox
 *        items={items}
 *        value={selectedRun}
 *        onValueChange={setSelectedRun}
 *      />
 *
 * 2) Uncontrolled mode
 *    - Omit `value`
 *    - Combobox maintains internal state for the selected value
 *    - Optionally pass `defaultSelected` for initial selection
 *
 *      <Combobox
 *        items={items}
 *        defaultSelected="gps"
 *      />
 *
 * Important notes:
 * - If `value` is provided, internal state is ignored.
 * - `defaultSelected` only applies in uncontrolled mode.
 */
export default function Combobox({
  items,
  placeholder = "",
  searchPlaceholder = "",
  value, // controlled if defined
  onValueChange,
  defaultSelected,
}: {
  items: Item[];
  placeholder?: string;
  searchPlaceholder?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  defaultSelected?: string;
}) {
  const [open, setOpen] = useState<boolean>(false);
  const [internalValue, setInternalValue] = useState(""); // selected value when uncontrolled

  const isControlled = value !== undefined;
  const selectedValue = isControlled ? value : internalValue;

  // If uncontrolled, apply defaultSelected once
  useEffect(() => {
    if (isControlled) {
      return;
    }

    if (!selectedValue && defaultSelected) {
      setInternalValue(defaultSelected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isControlled, defaultSelected]);

  const selectedItem = useMemo(
    () => items.find((i) => i.value === selectedValue),
    [items, selectedValue],
  );

  function setSelected(newValue: string) {
    if (isControlled) {
      onValueChange?.(newValue);
    } else {
      setInternalValue(newValue);
      onValueChange?.(newValue);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          <span className="min-w-0 flex-1 truncate text-left">
            {selectedItem ? selectedItem.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-w-100 w-full p-0 z-1000">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.value}
                  value={item.value}
                  onSelect={(currentValue) => {
                    // If we re-select the currently selected value, we want to effectively deselect it
                    const newValue =
                      currentValue === selectedValue ? "" : currentValue;
                    setSelected(newValue);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === item.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
