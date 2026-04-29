import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { GradingProvider } from './GradingContext'
import LabsPage      from './pages/LabsPage'
import LabDashboard  from './pages/LabDashboard'
import ReviewPage    from './pages/ReviewPage'
import './index.css'

export default function App() {
  return (
    <BrowserRouter>
      <GradingProvider>
        <Routes>
          <Route path="/"                              element={<LabsPage/>}/>
          <Route path="/labs/:labId"                   element={<LabDashboard/>}/>
          <Route path="/labs/:labId/review/:reportId"  element={<ReviewPage/>}/>
        </Routes>
      </GradingProvider>
    </BrowserRouter>
  )
}
