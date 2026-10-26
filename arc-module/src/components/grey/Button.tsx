import React from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  children: React.ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16181C] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed select-none'

  const variants = {
    primary: 'bg-[#16181C] text-white hover:bg-[#2a2d33] active:scale-[0.98]',
    secondary: 'bg-[#F4F3EE] text-[#16181C] border border-[#E8E6DF] hover:bg-[#EDECEA] active:scale-[0.98]',
    ghost: 'bg-transparent text-[#16181C] hover:bg-[#F4F3EE] active:scale-[0.98]',
    danger: 'bg-[#D63B3B] text-white hover:bg-[#b83030] active:scale-[0.98]',
  }

  const sizes = {
    sm: 'h-8 px-3 text-sm',
    md: 'h-10 px-4 text-sm',
    lg: 'h-12 px-6 text-base',
  }

  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading}
      {...rest}
    >
      {loading && (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" aria-hidden="true" />
      )}
      {children}
    </button>
  )
}
