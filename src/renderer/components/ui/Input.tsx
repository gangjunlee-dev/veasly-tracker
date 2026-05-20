"use client";

import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/format";

type FieldLabelProps = {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
};

export function Field({ label, hint, error, required, children }: FieldLabelProps) {
  return (
    <label className="block">
      {label ? (
        <span className="mb-1.5 block text-sm font-semibold text-foreground">
          {label}
          {required ? <span className="ml-1 text-danger">*</span> : null}
        </span>
      ) : null}
      {children}
      {hint && !error ? (
        <span className="mt-1.5 block text-xs text-foreground-muted">{hint}</span>
      ) : null}
      {error ? (
        <span className="mt-1.5 block text-xs font-medium text-danger">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn("vt-input", className)} {...rest} />;
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={cn("vt-input appearance-none pr-9 cursor-pointer", className)}
      {...rest}
    >
      {children}
    </select>
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn("vt-input min-h-[6rem] resize-y", className)}
      {...rest}
    />
  );
});
