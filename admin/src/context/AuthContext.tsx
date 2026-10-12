import React, { createContext, useContext, useState, useEffect } from 'react'
import { AdminUser, AuthResponse, LoginCredentials } from '../types'
import { authService } from '../services/authService'

interface AuthContextType {
  admin: AdminUser | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (credentials: LoginCredentials) => Promise<void>
  logout: () => void
  setAdmin: (admin: AdminUser | null) => void
  updateAdminProfile: (updated: Partial<AdminUser>) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [admin, setAdmin] = useState<AdminUser | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        // Support SSO/redirection login parameters from storefront
        const params = new URLSearchParams(window.location.search)
        const paramToken = params.get('token')
        const paramUserRaw = params.get('user')

        if (paramToken && paramUserRaw) {
          const parsed = JSON.parse(paramUserRaw)
          // Normalize user object fields for admin compatibility
          const adminUser = {
            id: parsed.id || 'admin-1',
            email: parsed.email || 'admin@meruveda.com',
            firstName: parsed.firstName || 'Veda',
            lastName: parsed.lastName || 'Admin',
            name: parsed.name || `${parsed.firstName || 'Veda'} ${parsed.lastName || 'Admin'}`.trim(),
            role: parsed.role || 'admin',
            avatar: parsed.avatar,
            isActive: true,
            createdAt: parsed.createdAt || new Date().toISOString(),
            lastLogin: new Date().toISOString(),
          }

          localStorage.setItem('admin_token', paramToken)
          localStorage.setItem('admin_user', JSON.stringify(adminUser))
          setToken(paramToken)
          setAdmin((adminUser as unknown as AdminUser) || null)

          // Clean URL parameters from browser history
          const newUrl = window.location.pathname + window.location.hash
          window.history.replaceState({}, document.title, newUrl)
        } else {
          const storedToken = localStorage.getItem('admin_token')
          const storedUser = localStorage.getItem('admin_user')
          if (storedToken && storedUser) {
            setToken(storedToken)
            const parsed = JSON.parse(storedUser)
            if (parsed && !parsed.name) {
              parsed.name = `${parsed.firstName || ''} ${parsed.lastName || ''}`.trim() || parsed.email || 'Admin'
            }
            setAdmin(parsed)
          }
        }
      } catch (error) {
        console.error('Error restoring auth session:', error)
      } finally {
        setIsLoading(false)
      }
    }
    initializeAuth()
  }, [])

  const login = async (credentials: LoginCredentials) => {
    setIsLoading(true)
    try {
      const response = await authService.login(credentials)
      const userObj = response.user || response.admin || null
      if (userObj && !userObj.name) {
        userObj.name = `${userObj.firstName || ''} ${userObj.lastName || ''}`.trim() || userObj.email || 'Admin'
      }
      setAdmin(userObj)
      setToken(response.token)
      localStorage.setItem('admin_token', response.token)
      localStorage.setItem('admin_user', JSON.stringify(userObj))
    } catch (error) {
      throw error
    } finally {
      setIsLoading(false)
    }
  }

  const logout = () => {
    setAdmin(null)
    setToken(null)
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_user')
  }

  const updateAdminProfile = (updated: Partial<AdminUser>) => {
    if (admin) {
      const newAdmin = { ...admin, ...updated }
      setAdmin(newAdmin)
      localStorage.setItem('admin_user', JSON.stringify(newAdmin))
    }
  }

  return (
    <AuthContext.Provider
      value={{
        admin,
        token,
        isAuthenticated: !!token,
        isLoading,
        login,
        logout,
        setAdmin,
        updateAdminProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
