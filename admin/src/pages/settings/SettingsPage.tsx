import React, { useState, useEffect } from 'react'
import { settingsService } from '../../services/settingsService'
import { StoreSettings } from '../../types'
import { Save, Settings, Landmark, Mail, Cloud, Users, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'

export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<StoreSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'general' | 'localization' | 'payments' | 'smtp' | 'integrations' | 'social'>('general')

  const fetchSettings = async () => {
    setIsLoading(true)
    try {
      const data = await settingsService.getSettings()
      setSettings(data)
    } catch (err) {
      toast.error('Failed to load store settings')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchSettings()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!settings) return

    setIsSaving(true)
    try {
      await settingsService.updateSettings(settings)
      toast.success('Settings updated successfully!')
    } catch (err) {
      toast.error('Failed to update settings')
    } finally {
      setIsSaving(false)
    }
  }

  const updateField = (field: keyof StoreSettings, value: any) => {
    if (!settings) return
    setSettings({
      ...settings,
      [field]: value,
    })
  }

  const updateSocialField = (field: keyof StoreSettings['socialLinks'], value: string) => {
    if (!settings) return
    setSettings({
      ...settings,
      socialLinks: {
        ...settings.socialLinks,
        [field]: value,
      },
    })
  }

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center text-slate-400">
        <RefreshCw className="h-6 w-6 animate-spin mr-2" />
        Loading settings...
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="text-center p-8 text-slate-400">
        Failed to load settings configuration.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Store Settings</h1>
          <p className="text-sm text-slate-500">Configure global configurations, payment systems, integration keys, and mailing details.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Navigation Sidebar */}
        <div className="card p-3 space-y-1 h-fit">
          <button
            onClick={() => setActiveTab('general')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'general'
                ? 'bg-primary-600 text-white shadow-glow'
                : 'text-slate-600 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Settings className="h-4 w-4" /> General Info
          </button>
          <button
            onClick={() => setActiveTab('localization')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'localization'
                ? 'bg-primary-600 text-white shadow-glow'
                : 'text-slate-600 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Landmark className="h-4 w-4" /> Taxes & Shipping
          </button>
          <button
            onClick={() => setActiveTab('payments')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'payments'
                ? 'bg-primary-600 text-white shadow-glow'
                : 'text-slate-600 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Landmark className="h-4 w-4" /> Payment Gateways
          </button>
          <button
            onClick={() => setActiveTab('smtp')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'smtp'
                ? 'bg-primary-600 text-white shadow-glow'
                : 'text-slate-600 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Mail className="h-4 w-4" /> SMTP Settings
          </button>
          <button
            onClick={() => setActiveTab('integrations')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'integrations'
                ? 'bg-primary-600 text-white shadow-glow'
                : 'text-slate-600 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Cloud className="h-4 w-4" /> Integrations
          </button>
          <button
            onClick={() => setActiveTab('social')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'social'
                ? 'bg-primary-600 text-white shadow-glow'
                : 'text-slate-600 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Users className="h-4 w-4" /> Social Channels
          </button>
        </div>

        {/* Tab Content Panel */}
        <div className="lg:col-span-3 card p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            
            {activeTab === 'general' && (
              <div className="space-y-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-white border-b pb-2">General Settings</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Store Name</label>
                    <input
                      type="text"
                      className="input"
                      value={settings.storeName}
                      onChange={(e) => updateField('storeName', e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="label">Support Email</label>
                    <input
                      type="email"
                      className="input"
                      value={settings.storeEmail}
                      onChange={(e) => updateField('storeEmail', e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="label">Store Phone Number</label>
                    <input
                      type="text"
                      className="input"
                      value={settings.storePhone}
                      onChange={(e) => updateField('storePhone', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Store Website</label>
                    <input
                      type="text"
                      className="input"
                      value={settings.storeWebsite || ''}
                      onChange={(e) => updateField('storeWebsite', e.target.value)}
                      placeholder="e.g. meruvedawellness.com"
                    />
                  </div>
                  <div>
                    <label className="label">Maintenance Mode</label>
                    <select
                      className="input"
                      value={settings.maintenanceMode ? 'true' : 'false'}
                      onChange={(e) => updateField('maintenanceMode', e.target.value === 'true')}
                    >
                      <option value="false">Live (Publicly Accessible)</option>
                      <option value="true">Under Maintenance (Admin Access Only)</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label">Store Address</label>
                  <textarea
                    rows={3}
                    className="input h-auto"
                    value={settings.storeAddress}
                    onChange={(e) => updateField('storeAddress', e.target.value)}
                  />
                </div>
              </div>
            )}

            {activeTab === 'localization' && (
              <div className="space-y-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-white border-b pb-2">Localization & Taxes</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Currency Code</label>
                    <input
                      type="text"
                      className="input"
                      value={settings.currency}
                      onChange={(e) => updateField('currency', e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="label">Timezone</label>
                    <input
                      type="text"
                      className="input"
                      value={settings.timezone}
                      onChange={(e) => updateField('timezone', e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="label">Default GST/Tax Rate (%)</label>
                    <input
                      type="number"
                      className="input"
                      value={settings.taxRate}
                      onChange={(e) => updateField('taxRate', parseFloat(e.target.value))}
                      required
                    />
                  </div>
                  <div>
                    <label className="label">Flat Shipping Charge</label>
                    <input
                      type="number"
                      className="input"
                      value={settings.shippingCharge}
                      onChange={(e) => updateField('shippingCharge', parseFloat(e.target.value))}
                      required
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="label">Free Shipping Minimum Threshold</label>
                    <input
                      type="number"
                      className="input"
                      value={settings.freeShippingAbove}
                      onChange={(e) => updateField('freeShippingAbove', parseFloat(e.target.value))}
                      required
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'payments' && (
              <div className="space-y-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-white border-b pb-2">Payment Gateways</h2>
                <div className="space-y-4">
                  <div>
                    <label className="label">Razorpay Key ID (Test/Live)</label>
                    <input
                      type="text"
                      className="input font-mono"
                      value={settings.razorpayKeyId || ''}
                      onChange={(e) => updateField('razorpayKeyId', e.target.value)}
                      placeholder="rzp_live_..."
                    />
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-250 dark:border-amber-900/50 p-4 rounded-xl text-xs text-amber-800 dark:text-amber-300">
                    <strong>Note:</strong> Cash on Delivery (COD) payment options are enabled by default for local checkouts. To route digital payments safely, provide your merchant credentials above.
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'smtp' && (
              <div className="space-y-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-white border-b pb-2">SMTP Mail Server Settings</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2">
                    <label className="label">SMTP Host</label>
                    <input
                      type="text"
                      className="input"
                      value={settings.smtpHost || ''}
                      onChange={(e) => updateField('smtpHost', e.target.value)}
                      placeholder="smtp.example.com"
                    />
                  </div>
                  <div>
                    <label className="label">SMTP Port</label>
                    <input
                      type="number"
                      className="input"
                      value={settings.smtpPort || ''}
                      onChange={(e) => updateField('smtpPort', parseInt(e.target.value))}
                      placeholder="587"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="label">SMTP Username</label>
                    <input
                      type="text"
                      className="input"
                      value={settings.smtpUser || ''}
                      onChange={(e) => updateField('smtpUser', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">SMTP Password</label>
                    <input
                      type="password"
                      className="input font-mono"
                      value={settings.smtpPassword || ''}
                      onChange={(e) => updateField('smtpPassword', e.target.value)}
                      placeholder="••••••••••••"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'integrations' && (
              <div className="space-y-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-white border-b pb-2">Third-Party Integrations</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Cloudinary Cloud Name</label>
                    <input
                      type="text"
                      className="input"
                      value={settings.cloudinaryCloudName || ''}
                      onChange={(e) => updateField('cloudinaryCloudName', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Cloudinary API Key</label>
                    <input
                      type="text"
                      className="input font-mono"
                      value={settings.cloudinaryApiKey || ''}
                      onChange={(e) => updateField('cloudinaryApiKey', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Google Analytics ID</label>
                    <input
                      type="text"
                      className="input"
                      value={settings.googleAnalyticsId || ''}
                      onChange={(e) => updateField('googleAnalyticsId', e.target.value)}
                      placeholder="G-XXXXXXXXXX"
                    />
                  </div>
                  <div>
                    <label className="label">Facebook Pixel ID</label>
                    <input
                      type="text"
                      className="input"
                      value={settings.facebookPixelId || ''}
                      onChange={(e) => updateField('facebookPixelId', e.target.value)}
                      placeholder="1234567890"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'social' && (
              <div className="space-y-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-white border-b pb-2">Social Channels</h2>
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="label">Facebook Page URL</label>
                    <input
                      type="url"
                      className="input"
                      value={settings.socialLinks.facebook || ''}
                      onChange={(e) => updateSocialField('facebook', e.target.value)}
                      placeholder="https://facebook.com/brand"
                    />
                  </div>
                  <div>
                    <label className="label">Instagram Profile URL</label>
                    <input
                      type="url"
                      className="input"
                      value={settings.socialLinks.instagram || ''}
                      onChange={(e) => updateSocialField('instagram', e.target.value)}
                      placeholder="https://instagram.com/brand"
                    />
                  </div>
                  <div>
                    <label className="label">Twitter / X URL</label>
                    <input
                      type="url"
                      className="input"
                      value={settings.socialLinks.twitter || ''}
                      onChange={(e) => updateSocialField('twitter', e.target.value)}
                      placeholder="https://twitter.com/brand"
                    />
                  </div>
                  <div>
                    <label className="label">YouTube Channel URL</label>
                    <input
                      type="url"
                      className="input"
                      value={settings.socialLinks.youtube || ''}
                      onChange={(e) => updateSocialField('youtube', e.target.value)}
                      placeholder="https://youtube.com/brand"
                    />
                  </div>
                  <div>
                    <label className="label">LinkedIn Page URL</label>
                    <input
                      type="url"
                      className="input"
                      value={settings.socialLinks.linkedin || ''}
                      onChange={(e) => updateSocialField('linkedin', e.target.value)}
                      placeholder="https://linkedin.com/company/brand"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Bottom Actions Bar */}
            <div className="flex justify-end pt-4 border-t">
              <button
                type="submit"
                disabled={isSaving}
                className="btn-primary inline-flex items-center gap-1.5 px-5 py-2.5 font-semibold text-sm rounded-xl disabled:opacity-50"
              >
                {isSaving ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {isSaving ? 'Saving Settings...' : 'Save All Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
export default SettingsPage
