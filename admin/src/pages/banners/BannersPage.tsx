import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Layers, Plus, Edit, Trash2, RefreshCw, ToggleLeft, ToggleRight,
  ArrowUp, ArrowDown, UploadCloud, Image as ImageIcon, X, Link2, ChevronDown
} from 'lucide-react';
import { bannerService, Banner } from '../../services/bannerService';
import { mediaService } from '../../services/mediaService';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import toast from 'react-hot-toast';
import { MediaLibrarySelectModal } from '../../components/ui/MediaLibrarySelectModal';

// ─── Image Upload Zone ────────────────────────────────────────────────────────
interface ImageUploadZoneProps {
  value: string;
  onChange: (url: string) => void;
  isUploading: boolean;
  setIsUploading: (b: boolean) => void;
}

const ImageUploadZone: React.FC<ImageUploadZoneProps> = ({ value, onChange, isUploading, setIsUploading }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [showUrlFallback, setShowUrlFallback] = useState(false);
  const [isMediaModalOpen, setIsMediaModalOpen] = useState(false);

  const uploadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Only image files are supported.');
      return;
    }
    setIsUploading(true);
    try {
      const result = await mediaService.uploadFile(file, 'banners');
      const url = result?.data?.public_url || result?.data?.url || result?.public_url || result?.url;
      if (!url) throw new Error('Upload succeeded but no URL returned');
      onChange(url);
      toast.success('Image uploaded successfully!');
    } catch (err: any) {
      toast.error(err?.message || 'Image upload failed.');
    } finally {
      setIsUploading(false);
    }
  }, [onChange, setIsUploading]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-2">
      {/* Main upload area */}
      {value ? (
        // Preview of uploaded image
        <div className="relative rounded-xl overflow-hidden border border-slate-700 group">
          <img src={value} alt="Banner preview" className="w-full h-36 object-cover" />
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 backdrop-blur text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
            >
              <UploadCloud className="h-3.5 w-3.5" /> Replace
            </button>
            <button
              type="button"
              onClick={() => onChange('')}
              className="flex items-center gap-1.5 bg-red-500/70 hover:bg-red-500 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
            >
              <X className="h-3.5 w-3.5" /> Remove
            </button>
          </div>
        </div>
      ) : (
        // Drop zone
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed cursor-pointer h-36 transition-all ${
            dragging
              ? 'border-primary-500 bg-primary-950/30'
              : 'border-slate-600 hover:border-primary-500 hover:bg-slate-800/50'
          }`}
        >
          {isUploading ? (
            <>
              <RefreshCw className="h-7 w-7 text-primary-400 animate-spin" />
              <span className="text-xs text-slate-400">Uploading image…</span>
            </>
          ) : (
            <>
              <UploadCloud className="h-7 w-7 text-slate-500" />
              <div className="text-center space-y-1">
                <p className="text-xs font-semibold text-slate-300">Drag & drop or click to upload</p>
                <p className="text-[10px] text-slate-500">PNG, JPG, WebP — max 8 MB</p>
                <p className="text-[10px] font-bold text-amber-400 bg-amber-950/30 px-2 py-0.5 rounded-md inline-block mt-1">
                  📐 Recommended: 1920 × 840 px (16:7 ratio)
                </p>
              </div>
            </>
          )}
        </div>
      )}

      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />

      {/* URL Fallback accordion */}
      <div className="flex gap-4 items-center">
        <button
          type="button"
          onClick={() => setShowUrlFallback(p => !p)}
          className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          <Link2 className="h-3 w-3" />
          Use external image URL instead
          <ChevronDown className={`h-3 w-3 transition-transform ${showUrlFallback ? 'rotate-180' : ''}`} />
        </button>

        <button
          type="button"
          onClick={() => setIsMediaModalOpen(true)}
          className="flex items-center gap-1 text-[11px] text-primary-500 hover:text-primary-400 transition-colors font-semibold"
        >
          <ImageIcon className="h-3 w-3" />
          Select from Media Library
        </button>
      </div>

      {showUrlFallback && (
        <input
          type="url"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="https://images.unsplash.com/..."
          className="input text-xs"
        />
      )}

      <MediaLibrarySelectModal
        isOpen={isMediaModalOpen}
        onClose={() => setIsMediaModalOpen(false)}
        onSelect={onChange}
      />
    </div>
  );
};

// ─── Live Preview ────────────────────────────────────────────────────────────
interface PreviewProps {
  imageUrl: string;
  heading: string;
  subheading: string;
  ctaText: string;
}

const LivePreview: React.FC<PreviewProps> = ({ imageUrl, heading, subheading, ctaText }) => (
  <div className="flex flex-col h-full gap-3">
    <h3 className="text-xs uppercase font-bold text-slate-400 tracking-wider">Live Slide Preview</h3>
    {/* 16:7 aspect ratio matching the storefront hero */}
    <div className="relative w-full rounded-xl overflow-hidden bg-slate-950 border border-slate-700/60" style={{ paddingBottom: '43.75%' }}>
      <div className="absolute inset-0">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="Preview"
            className="w-full h-full object-cover"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-600">
            <ImageIcon className="h-8 w-8" />
            <span className="text-[10px] font-mono">Upload an image to see preview</span>
          </div>
        )}
        {/* Vignette */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-[#220330]/80" />
        {/* Glass card */}
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className="bg-[#220330]/20 backdrop-blur-xl border border-[#d4af37]/20 rounded-2xl p-4 text-center space-y-1.5 shadow-[0_0_30px_rgba(212,175,55,0.12)] max-w-[80%]">
            <p className="text-[8px] uppercase tracking-widest text-[#e5c158] font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
              MeruVeda Ayurvedic Wellness
            </p>
            <h2 className="font-serif font-bold text-[#d4af37] text-sm leading-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
              {heading || 'Your Heading Here'}
            </h2>
            <p className="text-white text-[9px] leading-snug drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] line-clamp-2">
              {subheading || 'Subheading / description text goes here.'}
            </p>
            <div className="pt-1">
              <span className="inline-block bg-[#d4af37] text-[#220330] text-[8px] font-black px-3 py-1 rounded-full shadow">
                {ctaText || 'Shop Now'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <p className="text-[9px] text-slate-500 text-center leading-relaxed">
      Preview uses the same glassmorphism card and vignette gradient as the live storefront (16:7 ratio).
    </p>
  </div>
);

// ─── Main Page ───────────────────────────────────────────────────────────────
export const BannersPage: React.FC = () => {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editingBanner, setEditingBanner] = useState<Banner | null>(null);

  // Form state
  const [heading, setHeading] = useState('');
  const [subheading, setSubheading] = useState('');
  const [ctaText, setCtaText] = useState('Shop Now');
  const [ctaLink, setCtaLink] = useState('/products');
  const [imageUrl, setImageUrl] = useState('');
  const [displayOrder, setDisplayOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

  const fetchBanners = async () => {
    setIsLoading(true);
    try {
      const data = await bannerService.getBanners();
      setBanners(data);
    } catch {
      toast.error('Failed to load banners');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchBanners(); }, []);

  const resetForm = () => {
    setEditingBanner(null);
    setHeading('');
    setSubheading('');
    setCtaText('Shop Now');
    setCtaLink('/products');
    setImageUrl('');
    setDisplayOrder(banners.length);
    setIsActive(true);
  };

  const openAddModal = () => { resetForm(); setIsOpen(true); };

  const openEditModal = (b: Banner) => {
    setEditingBanner(b);
    setHeading(b.heading);
    setSubheading(b.subheading || '');
    setCtaText(b.cta_text || 'Shop Now');
    setCtaLink(b.cta_link || '/products');
    setImageUrl(b.image_url);
    setDisplayOrder(b.display_order);
    setIsActive(b.is_active);
    setIsOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!heading.trim()) { toast.error('Heading is required.'); return; }
    if (!imageUrl.trim()) { toast.error('Please upload or provide an image.'); return; }

    const payload: Partial<Banner> = {
      heading, subheading: subheading || undefined,
      cta_text: ctaText, cta_link: ctaLink,
      image_url: imageUrl, display_order: Number(displayOrder), is_active: isActive,
    };

    try {
      if (editingBanner?.id) {
        await bannerService.updateBanner(editingBanner.id, payload);
        toast.success('Banner updated!');
      } else {
        await bannerService.createBanner(payload);
        toast.success('Banner created!');
      }
      setIsOpen(false);
      fetchBanners();
    } catch { toast.error('Failed to save banner.'); }
  };

  const handleToggle = async (b: Banner) => {
    if (!b.id) return;
    try {
      await bannerService.updateBanner(b.id, { is_active: !b.is_active });
      fetchBanners();
    } catch { toast.error('Failed to update status.'); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try { await bannerService.deleteBanner(deleteId); toast.success('Banner deleted.'); fetchBanners(); }
    catch { toast.error('Failed to delete banner.'); }
    finally { setDeleteId(null); }
  };

  const moveOrder = async (b: Banner, dir: 'up' | 'down') => {
    if (!b.id) return;
    const idx = banners.findIndex(x => x.id === b.id);
    const target = banners[dir === 'up' ? idx - 1 : idx + 1];
    if (!target?.id) return;
    try {
      await bannerService.updateBanner(b.id, { display_order: target.display_order });
      await bannerService.updateBanner(target.id, { display_order: b.display_order });
      fetchBanners();
    } catch { toast.error('Failed to re-order.'); }
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Hero Banners</h1>
          <p className="text-sm text-slate-500 mt-0.5">Configure the coverflow slideshow on the storefront homepage.</p>
        </div>
        <button
          onClick={openAddModal}
          className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl"
        >
          <Plus className="h-4 w-4" /> Add Slide
        </button>
      </div>

      {/* Banner cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {isLoading ? (
          <div className="col-span-3 py-16 text-center text-slate-400">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 opacity-40" />
            Loading slides…
          </div>
        ) : banners.length === 0 ? (
          <div className="col-span-3 py-16 text-center text-slate-500 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
            <Layers className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-semibold">No hero slides yet.</p>
            <p className="text-xs mt-1 text-slate-400">Add slides to power the coverflow hero on the storefront.</p>
          </div>
        ) : (
          banners.map((b, idx) => (
            <div key={b.id || idx} className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden flex flex-col">
              {/* Thumbnail with glass overlay preview */}
              <div className="relative bg-slate-900" style={{ paddingBottom: '43.75%' }}>
                <div className="absolute inset-0">
                  {b.image_url ? (
                    <img src={b.image_url} alt={b.heading} className="w-full h-full object-cover opacity-75" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-600">
                      <ImageIcon className="h-8 w-8" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#220330]/60" />
                  {/* Mini glass card */}
                  <div className="absolute inset-0 flex items-center justify-center p-3">
                    <div className="bg-[#220330]/25 backdrop-blur-md border border-[#d4af37]/20 rounded-xl p-2.5 text-center max-w-[85%] shadow-[0_0_20px_rgba(212,175,55,0.1)]">
                      <p className="text-[#d4af37] text-[9px] font-bold drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] truncate">{b.heading}</p>
                      {b.subheading && (
                        <p className="text-white text-[8px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] line-clamp-1 mt-0.5 opacity-80">{b.subheading}</p>
                      )}
                    </div>
                  </div>
                  {/* Status badge */}
                  <span className={`absolute top-2 left-2 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full shadow ${
                    b.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-900/60 dark:text-slate-400'
                  }`}>
                    {b.is_active ? 'Active' : 'Inactive'}
                  </span>
                  {/* Order badge */}
                  <span className="absolute top-2 right-2 bg-black/50 text-white text-[9px] font-bold px-2 py-0.5 rounded-full">
                    #{b.display_order}
                  </span>
                </div>
              </div>

              {/* Card footer */}
              <div className="px-4 py-3 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-700">
                {/* Re-order */}
                <div className="flex gap-1">
                  <button onClick={() => moveOrder(b, 'up')} disabled={idx === 0}
                    className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-400 transition-colors">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => moveOrder(b, 'down')} disabled={idx === banners.length - 1}
                    className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-400 transition-colors">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  <button onClick={() => handleToggle(b)} title={b.is_active ? 'Deactivate' : 'Activate'}
                    className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 transition-colors">
                    {b.is_active
                      ? <ToggleRight className="h-4 w-4 text-emerald-500" />
                      : <ToggleLeft className="h-4 w-4" />
                    }
                  </button>
                  <button onClick={() => openEditModal(b)}
                    className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-blue-500 transition-colors">
                    <Edit className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setDeleteId(b.id || null)}
                    className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-red-500 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create / Edit Modal */}
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)}
        title={editingBanner ? 'Edit Hero Slide' : 'Create Hero Slide'}
        size="xxxl"
      >
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Form — 3 cols */}
          <form onSubmit={handleSubmit} className="lg:col-span-3 space-y-5">
            {/* Image upload */}
            <div>
              <label className="label font-semibold text-sm mb-2 block">Background Image *</label>
              <ImageUploadZone
                value={imageUrl}
                onChange={setImageUrl}
                isUploading={isUploading}
                setIsUploading={setIsUploading}
              />
            </div>

            {/* Heading */}
            <div>
              <label className="label font-semibold text-sm">Heading *</label>
              <input
                type="text"
                required
                value={heading}
                onChange={e => setHeading(e.target.value)}
                placeholder="e.g. Pure Ayurvedic Remedies"
                className="input mt-1 w-full"
              />
            </div>

            {/* Subheading */}
            <div>
              <label className="label font-semibold text-sm">Subheading</label>
              <textarea
                value={subheading}
                onChange={e => setSubheading(e.target.value)}
                placeholder="Brief tagline visible beneath the heading…"
                rows={2}
                className="input mt-1 w-full resize-none"
              />
            </div>

            {/* CTA Label + Link */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label font-semibold text-sm">CTA Button Label</label>
                <input
                  type="text"
                  value={ctaText}
                  onChange={e => setCtaText(e.target.value)}
                  placeholder="Shop Now"
                  className="input mt-1 w-full"
                />
              </div>
              <div>
                <label className="label font-semibold text-sm">CTA Link</label>
                <input
                  type="text"
                  value={ctaLink}
                  onChange={e => setCtaLink(e.target.value)}
                  placeholder="/products"
                  className="input mt-1 w-full"
                />
              </div>
            </div>

            {/* Display order + active toggle */}
            <div className="flex items-center gap-6">
              <div className="flex-1">
                <label className="label font-semibold text-sm">Display Order</label>
                <input
                  type="number"
                  value={displayOrder}
                  onChange={e => setDisplayOrder(Number(e.target.value))}
                  min={0}
                  className="input mt-1 w-full"
                />
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer pt-5 select-none">
                <div
                  onClick={() => setIsActive(p => !p)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isActive ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isActive ? 'translate-x-6' : 'translate-x-1'}`} />
                </div>
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {isActive ? 'Published' : 'Draft'}
                </span>
              </label>
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-700">
              <button type="button" onClick={() => setIsOpen(false)} className="btn-outline px-5 py-2 text-sm">
                Cancel
              </button>
              <button type="submit" disabled={isUploading} className="btn-primary px-5 py-2 text-sm disabled:opacity-60">
                {isUploading ? 'Uploading…' : editingBanner ? 'Save Changes' : 'Create Slide'}
              </button>
            </div>
          </form>

          {/* Live Preview — 2 cols */}
          <div className="lg:col-span-2">
            <LivePreview imageUrl={imageUrl} heading={heading} subheading={subheading} ctaText={ctaText} />
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Slide"
        message="Are you sure you want to permanently delete this hero banner? This cannot be undone."
        isDestructive
        confirmText="Delete"
      />
    </div>
  );
};

export default BannersPage;
