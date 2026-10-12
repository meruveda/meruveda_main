import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { ThemeProvider } from './context/ThemeContext'
import { AuthProvider } from './context/AuthContext'
import { SidebarProvider } from './context/SidebarContext'
import { ROUTES } from './constants/routes'

// Layouts & Route Wrappers
import { AdminLayout } from './layouts/AdminLayout'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { PublicRoute } from './routes/PublicRoute'

// Page Components
import { Login } from './pages/auth/Login'
import { DashboardPage } from './pages/dashboard/DashboardPage'
import { ProductsPage } from './pages/products/ProductsPage'
import { ProductDetailPage } from './pages/products/ProductDetailPage'
import { ProductFormPage } from './pages/products/ProductFormPage'
import { CategoriesPage } from './pages/categories/CategoriesPage'
import { InventoryPage } from './pages/inventory/InventoryPage'
import { OrdersPage } from './pages/orders/OrdersPage'
import { OrderDetailPage } from './pages/orders/OrderDetailPage'
import { CustomersPage } from './pages/customers/CustomersPage'
import { CustomerProfilePage } from './pages/customers/CustomerProfilePage'
import { ReviewsPage } from './pages/reviews/ReviewsPage'
import { CouponsPage } from './pages/coupons/CouponsPage'
import { MediaLibraryPage } from './pages/media/MediaLibraryPage'
import { JournalPage } from './pages/journal/JournalPage'
import { JournalFormPage } from './pages/journal/JournalFormPage'
import { BannersPage } from './pages/banners/BannersPage'
import { AnalyticsPage } from './pages/analytics/AnalyticsPage'
import { TransactionsPage } from './pages/transactions/TransactionsPage'
import { NotificationsPage } from './pages/notifications/NotificationsPage'
import { SupportPage } from './pages/support/SupportPage'
import { UsersPage } from './pages/users/UsersPage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { ActivityLogsPage } from './pages/activity/ActivityLogsPage'

// Setup React Query Client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <SidebarProvider>
            <BrowserRouter basename="/admin">
              <Routes>
                {/* Public Auth Routes */}
                <Route
                  path={ROUTES.LOGIN}
                  element={
                    <PublicRoute>
                      <Login />
                    </PublicRoute>
                  }
                />

                {/* Authenticated Admin Dashboard Layout Routes */}
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <AdminLayout />
                    </ProtectedRoute>
                  }
                >
                  {/* Default redirect to Dashboard */}
                  <Route index element={<Navigate to={ROUTES.DASHBOARD} replace />} />
                  <Route path={ROUTES.DASHBOARD} element={<DashboardPage />} />

                  {/* Catalog Routes */}
                  <Route path={ROUTES.PRODUCTS} element={<ProductsPage />} />
                  <Route path={ROUTES.PRODUCTS_ADD} element={<ProductFormPage />} />
                  <Route path={ROUTES.PRODUCTS_EDIT} element={<ProductFormPage />} />
                  <Route path={ROUTES.PRODUCTS_VIEW} element={<ProductDetailPage />} />
                  <Route path={ROUTES.CATEGORIES} element={<CategoriesPage />} />
                  <Route path={ROUTES.INVENTORY} element={<InventoryPage />} />

                  {/* Commerce Routes */}
                  <Route path={ROUTES.ORDERS} element={<OrdersPage />} />
                  <Route path={ROUTES.ORDERS_DETAIL} element={<OrderDetailPage />} />
                  <Route path={ROUTES.CUSTOMERS} element={<CustomersPage />} />
                  <Route path={ROUTES.CUSTOMERS_PROFILE} element={<CustomerProfilePage />} />
                  <Route path={ROUTES.REVIEWS} element={<ReviewsPage />} />
                  <Route path={ROUTES.COUPONS} element={<CouponsPage />} />

                  {/* Content Management Routes */}
                  <Route path={ROUTES.MEDIA} element={<MediaLibraryPage />} />
                  <Route path={ROUTES.JOURNAL} element={<JournalPage />} />
                  <Route path={ROUTES.JOURNAL_ADD} element={<JournalFormPage />} />
                  <Route path={ROUTES.JOURNAL_EDIT} element={<JournalFormPage />} />
                  <Route path={ROUTES.BANNERS} element={<BannersPage />} />

                  {/* Analytics & Transactions */}
                  <Route path={ROUTES.ANALYTICS} element={<AnalyticsPage />} />
                  <Route path={ROUTES.TRANSACTIONS} element={<TransactionsPage />} />

                  {/* Operations & Administration */}
                  <Route path={ROUTES.ADMINS} element={<UsersPage />} />
                  <Route path={ROUTES.NOTIFICATIONS} element={<NotificationsPage />} />
                  <Route path={ROUTES.SUPPORT} element={<SupportPage />} />
                  <Route path={ROUTES.SETTINGS} element={<SettingsPage />} />
                  <Route path={ROUTES.ACTIVITY} element={<ActivityLogsPage />} />

                  {/* Wildcard Fallback */}
                  <Route path="*" element={<Navigate to={ROUTES.DASHBOARD} replace />} />
                </Route>

                {/* Catch-all Wildcard */}
                <Route path="*" element={<Navigate to={ROUTES.DASHBOARD} replace />} />
              </Routes>
            </BrowserRouter>
            <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
          </SidebarProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

export default App
