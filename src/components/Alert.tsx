import { AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react'

interface AlertProps {
  type: 'success' | 'error' | 'info' | 'warning'
  title: string
  message?: string
  onDismiss?: () => void
  dismissible?: boolean
}

const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
}

const styleMap = {
  success: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  error: 'bg-red-50 border-red-200 text-red-900',
  info: 'bg-blue-50 border-blue-200 text-blue-900',
  warning: 'bg-amber-50 border-amber-200 text-amber-900',
}

const iconColorMap = {
  success: 'text-emerald-600',
  error: 'text-red-600',
  info: 'text-blue-600',
  warning: 'text-amber-600',
}

export function Alert({
  type,
  title,
  message,
  onDismiss,
  dismissible = true,
}: AlertProps) {
  const Icon = iconMap[type]

  return (
    <div className={`alert ${styleMap[type]} border rounded-lg`}>
      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${iconColorMap[type]}`} />
      <div className="flex-1">
        <h3 className="font-semibold">{title}</h3>
        {message && <p className="text-sm mt-1 opacity-90">{message}</p>}
      </div>
      {dismissible && (
        <button
          onClick={onDismiss}
          className="text-sm font-medium opacity-75 hover:opacity-100 transition-opacity"
        >
          Dismiss
        </button>
      )}
    </div>
  )
}
