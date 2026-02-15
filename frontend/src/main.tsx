import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.tsx'
import AppsPage from './AppsPage.tsx'
import AmazonSearchPage from './AmazonSearchPage.tsx'
import Navbar from './Navbar.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Navbar />
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/apps" element={<AppsPage />} />
        <Route path="/apps/amazon" element={<AmazonSearchPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
