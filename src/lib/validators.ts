/**
 * Input validation utilities
 */

export interface ValidationError {
  field: string
  message: string
}

export class ValidationResult {
  constructor(public errors: ValidationError[] = []) {}

  get isValid() {
    return this.errors.length === 0
  }

  addError(field: string, message: string) {
    this.errors.push({ field, message })
    return this
  }

  getErrorsByField(field: string) {
    return this.errors.filter(e => e.field === field)
  }
}

// String validators
export function isEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return re.test(email)
}

export function isPhoneNumber(phone: string): boolean {
  const re = /^[\d\s\-\+\(\)]{7,}$/
  return re.test(phone)
}

export function isStrongPin(pin: string): boolean {
  return pin.length >= 4 && /^\d+$/.test(pin)
}

export function isEmpty(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0
}

export function minLength(value: string, min: number): boolean {
  return value.length >= min
}

export function maxLength(value: string, max: number): boolean {
  return value.length <= max
}

// Number validators
export function isPositiveNumber(value: number): boolean {
  return value > 0 && isFinite(value)
}

export function isNonNegativeNumber(value: number): boolean {
  return value >= 0 && isFinite(value)
}

export function isBetween(value: number, min: number, max: number): boolean {
  return value >= min && value <= max
}

// Business validators
export function validateProductForm(data: {
  name: string
  price: string
  unit: string
  stock_qty?: string
  stock_alert?: string
}): ValidationResult {
  const result = new ValidationResult()

  if (isEmpty(data.name)) {
    result.addError('name', 'Product name is required')
  } else if (!maxLength(data.name, 100)) {
    result.addError('name', 'Product name must be 100 characters or less')
  }

  const price = parseFloat(data.price)
  if (isEmpty(data.price) || isNaN(price)) {
    result.addError('price', 'Valid price is required')
  } else if (!isNonNegativeNumber(price)) {
    result.addError('price', 'Price must be positive')
  }

  if (isEmpty(data.unit)) {
    result.addError('unit', 'Unit is required')
  }

  if (isEmpty(data.stock_qty || '')) {
    result.addError('stock_qty', 'Stock quantity is required')
  } else {
    const stock = parseFloat(data.stock_qty!.trim())
    if (isNaN(stock) || !isNonNegativeNumber(stock)) {
      result.addError('stock_qty', 'Stock quantity must begin with a valid number')
    }
  }

  const alert = parseInt(data.stock_alert || '10', 10)
  if (isNaN(alert) || !isNonNegativeNumber(alert)) {
    result.addError('stock_alert', 'Stock alert must be a valid number')
  }

  return result
}

export function validateStaffForm(data: {
  full_name: string
  email: string
  pin: string
}): ValidationResult {
  const result = new ValidationResult()

  if (isEmpty(data.full_name)) {
    result.addError('full_name', 'Full name is required')
  } else if (!maxLength(data.full_name, 100)) {
    result.addError('full_name', 'Name must be 100 characters or less')
  }

  if (isEmpty(data.email)) {
    result.addError('email', 'Email is required')
  } else if (!isEmail(data.email)) {
    result.addError('email', 'Invalid email format')
  }

  if (isEmpty(data.pin)) {
    result.addError('pin', 'PIN is required')
  } else if (!isStrongPin(data.pin)) {
    result.addError('pin', 'PIN must be at least 4 digits')
  }

  return result
}

export function validateCustomerForm(data: {
  name: string
  phone?: string
  email?: string
}): ValidationResult {
  const result = new ValidationResult()

  if (isEmpty(data.name)) {
    result.addError('name', 'Customer name is required')
  } else if (!maxLength(data.name, 100)) {
    result.addError('name', 'Name must be 100 characters or less')
  }

  if (data.phone && !isPhoneNumber(data.phone)) {
    result.addError('phone', 'Invalid phone number format')
  }

  if (data.email && !isEmail(data.email)) {
    result.addError('email', 'Invalid email format')
  }

  return result
}

export function validateCategoryForm(data: { name: string }): ValidationResult {
  const result = new ValidationResult()

  if (isEmpty(data.name)) {
    result.addError('name', 'Category name is required')
  } else if (!maxLength(data.name, 50)) {
    result.addError('name', 'Category name must be 50 characters or less')
  }

  return result
}

export function validateShopSettingsForm(data: {
  shop_name: string
  currency: string
  tax_rate: string
}): ValidationResult {
  const result = new ValidationResult()

  if (isEmpty(data.shop_name)) {
    result.addError('shop_name', 'Shop name is required')
  }

  if (isEmpty(data.currency)) {
    result.addError('currency', 'Currency is required')
  }

  const taxRate = parseFloat(data.tax_rate)
  if (isNaN(taxRate) || !isBetween(taxRate, 0, 100)) {
    result.addError('tax_rate', 'Tax rate must be between 0 and 100')
  }

  return result
}
