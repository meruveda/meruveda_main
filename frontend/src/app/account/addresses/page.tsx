"use client";

import { useEffect, useState } from "react";
import { Briefcase, Home, MapPin, Pencil, Plus } from "lucide-react";
import { addressService, formatAddress } from "@/services/accountService";
import type { AccountAddress, AddressType } from "@/types/account";
import { isValidPhone, isValidPincode, normalizePhone10 } from "@/types/account";
import { ConfirmDialog, EmptyState, Notice, SectionHeader } from "@/components/account/ui";

const EMPTY_FORM = {
  fullName: "",
  houseFlat: "",
  street: "",
  landmark: "",
  city: "",
  state: "",
  pincode: "",
  phone: "",
  type: "Home" as AddressType,
  isDefault: false,
};

type FormState = typeof EMPTY_FORM;

export default function AddressesPage() {
  const [addresses, setAddresses] = useState<AccountAddress[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    setAddresses(addressService.list());
  }, []);

  const openAdd = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, isDefault: addresses.length === 0 });
    setErrors({});
    setFormOpen(true);
  };

  const openEdit = (a: AccountAddress) => {
    setEditingId(a.id);
    setForm({
      fullName: a.fullName,
      houseFlat: a.houseFlat,
      street: a.street,
      landmark: a.landmark || "",
      city: a.city,
      state: a.state,
      pincode: a.pincode,
      phone: a.phone,
      type: a.type,
      isDefault: a.isDefault,
    });
    setErrors({});
    setFormOpen(true);
  };

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (form.fullName.trim().length < 2) e.fullName = "Enter the recipient's full name.";
    if (!form.houseFlat.trim()) e.houseFlat = "House / flat number is required.";
    if (!form.street.trim()) e.street = "Street / lane is required.";
    if (!form.city.trim()) e.city = "City is required.";
    if (!form.state.trim()) e.state = "State is required.";
    if (!isValidPincode(form.pincode)) e.pincode = "Enter a valid 6-digit pincode.";
    if (!isValidPhone(form.phone)) e.phone = "Enter a valid 10-digit mobile number.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    const payload = {
      fullName: form.fullName.trim(),
      houseFlat: form.houseFlat.trim(),
      street: form.street.trim(),
      landmark: form.landmark.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      pincode: form.pincode.trim(),
      phone: `+91 ${normalizePhone10(form.phone)}`,
      type: form.type,
      isDefault: form.isDefault,
    };
    if (editingId) {
      setAddresses(addressService.update(editingId, payload));
      setNotice("Address updated.");
    } else {
      addressService.create(payload);
      setAddresses(addressService.list());
      setNotice("New address saved.");
    }
    setFormOpen(false);
    setEditingId(null);
    setTimeout(() => setNotice(null), 3000);
  };

  const confirmDelete = () => {
    if (!confirmId) return;
    setAddresses(addressService.remove(confirmId));
    setConfirmId(null);
    setNotice("Address deleted.");
    setTimeout(() => setNotice(null), 3000);
  };

  const input = "w-full border border-gray-300 rounded-lg px-4 py-2 outline-none focus:border-gold focus:ring-1 focus:ring-gold/30 transition-all text-sm";
  const label = "block text-gray-700 font-medium mb-1 text-xs";
  const err = "text-xs text-red-600 mt-1";

  return (
    <div>
      <SectionHeader
        title="Saved Addresses"
        subtitle="Delivery locations for faster checkout. Only you can see these."
        action={
          !formOpen ? (
            <button onClick={openAdd} className="bg-deep-purple text-white hover:bg-deep-purple/90 px-4 py-2.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap">
              <Plus size={14} /> Add New Address
            </button>
          ) : undefined
        }
      />

      {notice && <Notice>{notice}</Notice>}

      {formOpen && (
        <form onSubmit={submit} noValidate className="bg-gray-50/50 p-5 md:p-6 rounded-2xl border border-gray-100 mb-8 space-y-4">
          <h3 className="font-playfair font-bold text-deep-purple text-lg">{editingId ? "Edit address" : "Add new address"}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="ad-name">Full name *</label>
              <input id="ad-name" className={input} value={form.fullName} onChange={set("fullName")} placeholder="Aarav Mehta" autoComplete="name" />
              {errors.fullName && <p className={err}>{errors.fullName}</p>}
            </div>
            <div>
              <label className={label} htmlFor="ad-phone">Phone number *</label>
              <input id="ad-phone" className={input} value={form.phone} onChange={set("phone")} placeholder="98765 43210" inputMode="tel" autoComplete="tel" />
              {errors.phone && <p className={err}>{errors.phone}</p>}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="ad-house">House / flat number *</label>
              <input id="ad-house" className={input} value={form.houseFlat} onChange={set("houseFlat")} placeholder="Flat 402, Tower B" />
              {errors.houseFlat && <p className={err}>{errors.houseFlat}</p>}
            </div>
            <div>
              <label className={label} htmlFor="ad-street">Street / lane *</label>
              <input id="ad-street" className={input} value={form.street} onChange={set("street")} placeholder="Green Glen Layout, Bellandur" />
              {errors.street && <p className={err}>{errors.street}</p>}
            </div>
          </div>
          <div>
            <label className={label} htmlFor="ad-landmark">Landmark <span className="text-gray-400">(optional)</span></label>
            <input id="ad-landmark" className={input} value={form.landmark} onChange={set("landmark")} placeholder="Near Central Mall" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={label} htmlFor="ad-city">City *</label>
              <input id="ad-city" className={input} value={form.city} onChange={set("city")} placeholder="Bengaluru" autoComplete="address-level2" />
              {errors.city && <p className={err}>{errors.city}</p>}
            </div>
            <div>
              <label className={label} htmlFor="ad-state">State *</label>
              <input id="ad-state" className={input} value={form.state} onChange={set("state")} placeholder="Karnataka" autoComplete="address-level1" />
              {errors.state && <p className={err}>{errors.state}</p>}
            </div>
            <div>
              <label className={label} htmlFor="ad-pin">Pincode *</label>
              <input id="ad-pin" className={input} value={form.pincode} onChange={set("pincode")} placeholder="560103" inputMode="numeric" maxLength={6} autoComplete="postal-code" />
              {errors.pincode && <p className={err}>{errors.pincode}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className={label}>Address type *</span>
            {(["Home", "Work", "Other"] as AddressType[]).map((t) => (
              <label key={t} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                <input type="radio" name="addressType" checked={form.type === t} onChange={() => setForm((p) => ({ ...p, type: t }))} className="accent-[#B08A3E]" />
                {t}
              </label>
            ))}
            <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer ml-auto">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm((p) => ({ ...p, isDefault: e.target.checked }))} className="accent-[#B08A3E]" />
              Set as default
            </label>
          </div>
          <div className="flex gap-3 justify-end pt-1">
            <button type="button" onClick={() => { setFormOpen(false); setEditingId(null); }} className="px-5 py-2.5 border border-gray-200 hover:bg-gray-100 rounded-lg text-xs font-bold text-gray-700">
              Cancel
            </button>
            <button type="submit" className="px-5 py-2.5 bg-deep-purple text-white hover:bg-deep-purple/90 rounded-lg text-xs font-bold">
              {editingId ? "Save Changes" : "Add Address"}
            </button>
          </div>
        </form>
      )}

      {addresses.length === 0 && !formOpen ? (
        <EmptyState
          icon={MapPin}
          title="No saved addresses"
          message="Add an address to speed up checkout. You can keep separate Home and Work addresses."
          ctaLabel="Add Your First Address"
          onCta={openAdd}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {addresses.map((addr) => (
            <div key={addr.id} className={`p-5 md:p-6 rounded-2xl border bg-white shadow-sm flex flex-col justify-between ${addr.isDefault ? "border-gold bg-gold/5" : "border-gray-100"}`}>
              <div>
                <div className="flex justify-between items-start mb-3 gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {addr.type === "Home" ? <Home size={15} className="text-gold" /> : addr.type === "Work" ? <Briefcase size={15} className="text-gold" /> : <MapPin size={15} className="text-gold" />}
                    <span className="font-bold text-deep-purple text-sm">{addr.type}</span>
                    {addr.isDefault && (
                      <span className="bg-gold/15 text-gold text-[10px] font-bold px-2 py-0.5 rounded-full border border-gold/30">Default</span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(addr)} className="p-1.5 text-gray-400 hover:text-deep-purple rounded transition-colors" aria-label={`Edit ${addr.type} address`}>
                      <Pencil size={15} />
                    </button>
                  </div>
                </div>
                <p className="font-bold text-deep-purple text-sm mb-1">{addr.fullName}</p>
                <p className="text-xs text-gray-600 leading-relaxed">{formatAddress(addr)}</p>
                <p className="text-xs text-gray-500 mt-2">Phone: {addr.phone}</p>
              </div>
              <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between gap-2 flex-wrap">
                {!addr.isDefault ? (
                  <button onClick={() => setAddresses(addressService.setDefault(addr.id))} className="text-xs text-gold hover:underline font-bold">
                    Set as Default
                  </button>
                ) : (
                  <span className="text-[11px] text-gray-400">Default delivery address</span>
                )}
                <button onClick={() => setConfirmId(addr.id)} className="text-xs text-red-500 hover:text-red-700 font-semibold">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmId !== null}
        title="Delete this address?"
        message="The address will be removed from your account. This cannot be undone."
        confirmLabel="Delete Address"
        onConfirm={confirmDelete}
        onClose={() => setConfirmId(null)}
      />
    </div>
  );
}
