import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppsPage from './AppsPage.tsx'
import AmazonSearchPage from './AmazonSearchPage.tsx'
import MapsPage from './MapsPage.tsx'
import ChatPage from './ChatPage.tsx'
import WebSearchPage from './WebSearchPage.tsx'
import FlappyBirdPage from './FlappyBirdPage.tsx'
import BooksPage from './BooksPage.tsx'
import TalkPage from './TalkPage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/apps" replace />} />
        <Route path="/apps" element={<AppsPage />} />
        <Route path="/apps/amazon" element={<AmazonSearchPage />} />
        <Route path="/apps/maps" element={<MapsPage />} />
        <Route path="/apps/chat" element={<ChatPage />} />
        <Route path="/apps/web-search" element={<WebSearchPage />} />
        <Route path="/apps/flappy-bird" element={<FlappyBirdPage />} />
        <Route path="/apps/books" element={<BooksPage />} />
        <Route path="/apps/talk" element={<TalkPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
