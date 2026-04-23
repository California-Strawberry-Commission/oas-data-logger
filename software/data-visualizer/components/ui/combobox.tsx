"use client";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";

export type Item = {
  value: string;
  label: string;
};

export type Group = {
  heading: string;
  items: Item[];
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
 * - If `items` and `groups` are both defined, items render first
 *   in an ungrouped CommandGroup, followed by the groups.
 */
export default function Combobox({
  items,
  groups,
  placeholder = "",
  searchPlaceholder = "",
  value, // controlled if defined
  onValueChange,
  defaultSelected,
  disabled,
}: {
  items?: Item[];
  groups?: Group[];
  placeholder?: string;
  searchPlaceholder?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  defaultSelected?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState<boolean>(false);
  const [internalValue, setInternalValue] = useState(""); // selected value when uncontrolled
  const commandListRef = useRef<HTMLDivElement>(null);

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

  // Scroll the selected item into view when the dropdown opens
  useEffect(() => {
    if (!open || !selectedValue) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const container = commandListRef.current;
      if (!container) {
        return;
      }
      const selectedEl = container.querySelector(
        `[data-value="${CSS.escape(selectedValue)}"]`,
      );
      selectedEl?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, selectedValue]);

  const allItems = useMemo(
    () => [...(items ?? []), ...(groups ? groups.flatMap((g) => g.items) : [])],
    [groups, items],
  );

  const selectedItem = useMemo(
    () => allItems.find((i) => i.value === selectedValue),
    [allItems, selectedValue],
  );

  function setSelected(newValue: string) {
    if (isControlled) {
      onValueChange?.(newValue);
    } else {
      setInternalValue(newValue);
      onValueChange?.(newValue);
    }
  }

  function renderItem(item: Item) {
    return (
      <CommandItem
        key={item.value}
        value={item.value}
        onSelect={(currentValue) => {
          // If we re-select the currently selected value, we want to effectively deselect it
          const newValue = currentValue === selectedValue ? "" : currentValue;
          setSelected(newValue);
          setOpen(false);
        }}
      >
        <Check
          className={cn(
            "mr-2 h-4 w-4",
            selectedValue === item.value ? "opacity-100" : "opacity-0",
          )}
        />
        {item.label}
      </CommandItem>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          disabled={disabled}
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
          <CommandList ref={commandListRef}>
            <CommandEmpty>No results found.</CommandEmpty>
            {items && items.length > 0 && (
              <CommandGroup>{items.map(renderItem)}</CommandGroup>
            )}
            {groups &&
              groups.map((group, idx) => (
                <React.Fragment key={group.heading}>
                  {(idx > 0 || (items && items.length > 0)) && (
                    <CommandSeparator />
                  )}
                  <CommandGroup heading={group.heading}>
                    {group.items.map(renderItem)}
                  </CommandGroup>
                </React.Fragment>
              ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
