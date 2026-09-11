import { NavLink, Route, Routes } from 'react-router-dom'
import { Bell, FileText, Home, Settings as SettingsIcon, Stethoscope } from 'lucide-react'
import { ToastHost } from './ui'
import HomePage from '../pages/Home'
import DocumentsPage from '../pages/Documents'
import DocFormPage from '../pages/DocForm'
import DocDetailPage from '../pages/DocDetail'
import VisitsPage from '../pages/Visits'
import VisitFormPage from '../pages/VisitForm'
import VisitDetailPage from '../pages/VisitDetail'
import RemindersPage from '../pages/Reminders'
import MedPlanFormPage from '../pages/MedPlanForm'
import ReminderFormPage from '../pages/ReminderForm'
import StatsPage from '../pages/Stats'
import SettingsPage from '../pages/Settings'

const NAV_ITEMS = [
  { to: '/', label: '首页', icon: Home },
  { to: '/docs', label: '单据', icon: FileText },
  { to: '/visits', label: '就诊', icon: Stethoscope },
  { to: '/reminders', label: '提醒', icon: Bell },
  { to: '/settings', label: '设置', icon: SettingsIcon },
]

function BottomNav() {
  return (
    <nav className="safe-bottom z-30 flex border-t border-stone-200 bg-white/95 backdrop-blur">
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
              isActive ? 'font-medium text-teal-600' : 'text-stone-400'
            }`
          }
        >
          <Icon size={22} strokeWidth={2} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

export function Layout() {
  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col bg-stone-50 shadow-sm">
      <div className="flex-1 overflow-y-auto pb-4">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/docs" element={<DocumentsPage />} />
          <Route path="/docs/new" element={<DocFormPage />} />
          <Route path="/docs/:id" element={<DocDetailPage />} />
          <Route path="/docs/:id/edit" element={<DocFormPage />} />
          <Route path="/visits" element={<VisitsPage />} />
          <Route path="/visits/new" element={<VisitFormPage />} />
          <Route path="/visits/:id" element={<VisitDetailPage />} />
          <Route path="/visits/:id/edit" element={<VisitFormPage />} />
          <Route path="/reminders" element={<RemindersPage />} />
          <Route path="/plans/new" element={<MedPlanFormPage />} />
          <Route path="/plans/:id/edit" element={<MedPlanFormPage />} />
          <Route path="/reminders/new" element={<ReminderFormPage />} />
          <Route path="/reminders/:id/edit" element={<ReminderFormPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </div>
      <BottomNav />
      <ToastHost />
    </div>
  )
}
