import {
  LayoutDashboard,
  Package,
  Tag,
  Warehouse,
  ShoppingCart,
  Users,
  Star,
  Ticket,
  Globe,
  ImageIcon,
  FileText,
  Layers,
  BarChart3,
  CreditCard,
  Bell,
  HeadphonesIcon,
  Shield,
  Settings,
  Activity,
  ExternalLink,
  type LucideIcon,
} from 'lucide-react'
import { ROUTES } from './routes'
import { CUSTOMER_WEBSITE_URL } from './config'

export interface SidebarItem {
  label: string
  href?: string
  icon: LucideIcon
  children?: SidebarItem[]
  badge?: string | number
  external?: boolean
  externalUrl?: string
  dividerBefore?: boolean
}

export interface SidebarGroup {
  title?: string
  items: SidebarItem[]
}

export const SIDEBAR_GROUPS: SidebarGroup[] = [
  {
    items: [
      { label: 'Dashboard', href: ROUTES.DASHBOARD, icon: LayoutDashboard },
    ],
  },
  {
    title: 'Catalog',
    items: [
      { label: 'Products',   href: ROUTES.PRODUCTS,   icon: Package },
      { label: 'Categories', href: ROUTES.CATEGORIES, icon: Tag },
    ],
  },
  {
    title: 'Commerce',
    items: [
      { label: 'Orders',    href: ROUTES.ORDERS,    icon: ShoppingCart },
      { label: 'Customers', href: ROUTES.CUSTOMERS, icon: Users },
      { label: 'Reviews',   href: ROUTES.REVIEWS,   icon: Star },
      { label: 'Coupons',   href: ROUTES.COUPONS,   icon: Ticket },
    ],
  },
  {
    title: 'Content',
    items: [
      { label: 'Media Library',  href: ROUTES.MEDIA, icon: ImageIcon },
      { label: 'Journal',        href: ROUTES.JOURNAL, icon: FileText },
      { label: 'Hero Banners',   href: ROUTES.BANNERS, icon: Layers },
    ],
  },
  {
    title: 'Reports',
    items: [
      { label: 'Transactions', href: ROUTES.TRANSACTIONS, icon: CreditCard },
      { label: 'Analytics',    href: ROUTES.ANALYTICS,    icon: BarChart3 },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'User Accounts',  href: ROUTES.ADMINS,        icon: Users },
      { label: 'Notifications',  href: ROUTES.NOTIFICATIONS, icon: Bell },
      { label: 'Support',        href: ROUTES.SUPPORT,       icon: HeadphonesIcon },
      { label: 'Activity Log',   href: ROUTES.ACTIVITY,      icon: Activity },
      { label: 'Settings',       href: ROUTES.SETTINGS,      icon: Settings },
    ],
  },
  {
    items: [
      {
        label: 'Open Website',
        icon: ExternalLink,
        external: true,
        externalUrl: CUSTOMER_WEBSITE_URL,
        dividerBefore: true,
      },
    ],
  },
]
