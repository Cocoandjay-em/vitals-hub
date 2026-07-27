import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import { AuthGate } from '@/components/AuthGate'

export default function App() {
  return (
    <AuthGate>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </AuthGate>
  )
}
