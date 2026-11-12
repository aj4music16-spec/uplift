import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';

import { TextField, type TextFieldProps } from '@/components/Fields';

export type FormTextFieldProps<T extends FieldValues> = Omit<TextFieldProps, 'value' | 'onChangeText' | 'onBlur' | 'error'> & {
  control: Control<T>;
  name: Path<T>;
  /** Optional input cleanup, e.g. digits only for codes. */
  transform?: (text: string) => string;
};

/** A design-system TextField bound to react-hook-form, with the field-level error under it. */
export function FormTextField<T extends FieldValues>({ control, name, transform, ...props }: FormTextFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          {...props}
          value={typeof field.value === 'string' ? field.value : ''}
          onChangeText={(text) => field.onChange(transform ? transform(text) : text)}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
        />
      )}
    />
  );
}
