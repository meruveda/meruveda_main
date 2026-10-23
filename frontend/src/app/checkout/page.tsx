"use client";

import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import {
  CreditCard,
  Truck,
  Package,
  Loader2,
  ChevronRight,
  ChevronDown,
  Plus,
  ShieldCheck,
  CheckCircle2,
  Mail,
  MapPin,
  Pencil,
  Trash2,
  Star
} from "lucide-react";
import axiosInstance from "@/api/axiosInstance";
import { track as trackEvent } from "@/lib/analytics";
import { INDIAN_STATES as STATES, isIndianState } from "@/constants/states";

// The checkout NEVER asks for an OTP. The contact step is a name, a mobile
// number and an email, confirmed with the "Continue" pill. There is no
// Send OTP button, no OTP input and no "verified" gate anywhere on this page,
// regardless of any config or env flag.
const SHIPPING_IS_TAXABLE = false; // TODO: PENDING CLIENT CONFIRMATION. Set to true to tax shipping charges.

// All Indian states and Union Territories — dropdown for the delivery address.
// Single source of truth: also drives validation on the saved-address path and
// the account address book.
const INDIAN_STATES = STATES;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PIN_RE = /^\d{6}$/;

import { DEFAULT_COUNTRY, Country, nationalDigits, fullPhoneDigits, isValidNational, isIndianNumber, formatDisplay } from "@/constants/countries";
import { CountryPhoneField } from "@/components/CountryPhoneField";

/**
 * A synthetic identity, never a real inbox.
 *
 * A guest checkout and a phone-only account both get a placeholder address.
 * It must never end up on an order as the customer's email.
 */
function isSyntheticEmail(email?: string | null): boolean {
  const e = String(email || "").toLowerCase();
  return e.endsWith("@meruveda.whatsapp") || e.endsWith("@meruveda.guest");
}

const ADDRESS_TYPES = ["Home", "Work", "Other"] as const;

type AddressFormState = {
  house: string;
  area: string;
  landmark: string;
  city: string;
  state: string;
  pincode: string;
  type: string;
  isDefault: boolean;
};

const emptyAddressForm = (): AddressFormState => ({
  house: "",
  area: "",
  landmark: "",
  city: "",
  state: "",
  pincode: "",
  type: "Home",
  isDefault: false,
});

/**
 * Searchable State / Union Territory combobox — native <select> cannot be
 * searched, and this keeps the checkout dependency-free.
 */
function StateSelect({
  id,
  value,
  onChange,
  className,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (state: string) => void;
  className: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return INDIAN_STATES;
    return INDIAN_STATES.filter((s) => s.toLowerCase().includes(q));
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const choose = (state: string) => {
    onChange(state);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          aria-autocomplete="list"
          aria-label="State / Union Territory"
          autoComplete="address-level1"
          value={open ? query : value}
          placeholder="Search state or UT"
          onFocus={() => {
            setQuery("");
            setActive(0);
            setOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (!open) return setOpen(true);
              setActive((i) => Math.min(i + 1, options.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              if (open && options[active]) {
                e.preventDefault();
                choose(options[active]);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
              setQuery("");
            }
          }}
          className={`${className} pr-9 ${invalid ? "border-red-400" : ""}`}
        />
        <ChevronDown
          size={15}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
        />
      </div>

      {open && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-40 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-xl"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-xs text-gray-500">No state matches “{query}”.</li>
          ) : (
            options.map((state, i) => (
              <li
                key={state}
                id={`${id}-option-${i}`}
                role="option"
                aria-selected={state === value}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(state);
                }}
                className={`cursor-pointer px-3 py-2 text-sm ${
                  state === value
                    ? "bg-deep-purple/5 font-semibold text-deep-purple"
                    : i === active
                      ? "bg-gold/15 text-deep-purple"
                      : "text-gray-700"
                }`}
              >
                {state}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}


// Combines the Amazon-style parts into the single multi-line string the order
// API, invoice PDF, Shiprocket and admin panel already read.
function formatAddressLine(form: { house: string; area: string; landmark: string }): string {
  return [form.house, form.area, form.landmark]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

/** Splits a stored address back into the House / Lane fields for editing. */
function splitAddressParts(addr: Address): { house: string; area: string } {
  if (addr.addressLine1 || addr.addressLine2) {
    return { house: addr.addressLine1 || "", area: addr.addressLine2 || "" };
  }
  const parts = (addr.addressLine || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return { house: parts[0] || "", area: parts.slice(1).join(", ") };
}

function isRajasthan(state: string): boolean {
  if (!state) return false;
  const s = state.trim().toLowerCase();
  const validMatches = ['rajasthan', 'rj', 'rajsthan', 'rajasthn', 'rajastan', 'rajasthna', 'rajastran', 'raj'];
  if (validMatches.includes(s)) return true;
  return s.startsWith('raj') && s.length >= 5;
}

interface Address {
  id: string;
  fullName: string;
  addressLine: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  type: string;
  isDefault: boolean;
  // Additive, optional only — carried through to the JSONB shipping_address.
  // Nothing here is required, so previously saved addresses keep working.
  addressLine1?: string;
  addressLine2?: string;
  landmark?: string;
  country?: string;
  pincode?: string;
}

const ADDRESSES_KEY = "meruveda_addresses";

function readStoredAddresses(): Address[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ADDRESSES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((a: any) => a && a.id) : [];
  } catch (err) {
    console.error(err);
    return [];
  }
}

function writeStoredAddresses(list: Address[]) {
  try {
    localStorage.setItem(ADDRESSES_KEY, JSON.stringify(list));
  } catch (err) {
    console.error(err);
  }
}

export default function CheckoutPage() {
  const { cart, cartTotal, removeFromCart, updateQuantity } = useCart();
  const { user, isAuthenticated, isLoading, saveProfile, openSession } = useAuth();
  const router = useRouter();

  // No separate login screen: the checkout form itself is the login.
  // Guests browse and reach checkout freely; identity is collected below.

  // States
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>("");
  const [showNewAddressForm, setShowNewAddressForm] = useState(false);
  // Non-null while an existing address is being edited rather than created.
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  // Delivery address fields (name/phone live in step 1, email sits in its own
  // block — they are merged in when the address is used).
  const [addressForm, setAddressForm] = useState<AddressFormState>(emptyAddressForm());
  const [addressSubmitted, setAddressSubmitted] = useState(false);

  // ---- Contact (step 1, shown on EVERY order) ----
  const [contactName, setContactName] = useState("");
  const [mobile, setMobile] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<Country>(DEFAULT_COUNTRY);
  /** The honeypot: a field a human never sees and never fills in. */
  const [website, setWebsite] = useState("");
  /** When the form was rendered - a form filled in implausibly fast is a bot. */
  const formRenderedAt = useRef<number>(Date.now());
  /**
   * The contact that was confirmed, as a SNAPSHOT of the name and the number.
   *
   * The confirmation is DERIVED from it, never a boolean that some other
   * state change can quietly clear: if the customer edits the name or the
   * number, the snapshot no longer matches and the pill goes back to
   * "Continue" by itself.
   */
  const [confirmedContact, setConfirmedContact] = useState<{ name: string; digits: string; email: string } | null>(null);
  const [isConfirmingContact, setIsConfirmingContact] = useState(false);
  const [contactError, setContactError] = useState("");
  /** The email of the contact step - it becomes the profile's email. */
  const [contactEmail, setContactEmail] = useState("");
  const [contactEmailError, setContactEmailError] = useState("");
  /** The general error of the contact / place-order block. */
  const [stepError, setStepError] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [mobileError, setMobileError] = useState("");
  /**
   * The Indian delivery contact.
   *
   * Shiprocket only ships inside India, so an order placed from another
   * country needs an Indian number the parcel can actually be delivered to.
   * It is required whenever the customer's own country is not India, and it
   * is the number Shiprocket receives.
   */
  const [deliveryContact, setDeliveryContact] = useState("");
  const [deliveryContactError, setDeliveryContactError] = useState("");

  const hydratedFromProfileRef = useRef(false);


  // Payment method state: strictly "payu" (Pay Online via PayU) or "cod" (Cash on Delivery)
  const [paymentMethod, setPaymentMethod] = useState<"payu" | "cod">("payu");

  const [couponCode, setCouponCode] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState({ code: "", amount: 0, percent: 0 });
  const [couponError, setCouponError] = useState("");
  const [orderNotes, setOrderNotes] = useState("");

  const [isPlacingOrder, setIsPlacingOrder] = useState(false);

  // Tracks which cart line is being removed so only that row shows a spinner.
  const [removingId, setRemovingId] = useState<string | null>(null);

  const handleRemoveItem = async (id: string) => {
    setRemovingId(id);
    try {
      await removeFromCart(id);
    } finally {
      setRemovingId(null);
    }
  };

  const shippingCharges = cartTotal >= 1000 ? 0 : 50;
  const [isServiceable, setIsServiceable] = useState(true);
  const [isCheckingShipping, setIsCheckingShipping] = useState(false);
  const [estimatedDeliveryDays, setEstimatedDeliveryDays] = useState(4);

  // True while the customer is entering the address by hand (nothing entered
  // yet on an open form still falls back to the selected saved address).
  // Decides which pincode the serviceability check and order payload use.
  const formTouched =
    addressForm.house.trim() !== "" ||
    addressForm.area.trim() !== "" ||
    addressForm.city.trim() !== "" ||
    addressForm.state.trim() !== "" ||
    addressForm.pincode.trim() !== "";
  const usesAddressForm = addresses.length === 0 || (showNewAddressForm && formTouched);
  const deliveryZip = usesAddressForm
    ? addressForm.pincode.trim()
    : addresses.find((a) => a.id === selectedAddressId)?.zipCode || "";

  // begin_checkout — once per checkout page visit with a non-empty cart.
  // This is the top of the funnel the admin dashboard reports on.
  useEffect(() => {
    if (cart.length === 0) return;
    trackEvent('begin_checkout', {
      value: Number(cartTotal) || 0,
      currency: 'INR',
      items: cart.map((item: any) => ({
        item_id: item.id,
        item_name: item.name,
        price: Number(item.price) || 0,
        quantity: Number(item.quantity) || 1,
      })),
    });
    // Intentionally mount-only: a re-render must not inflate the funnel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shiprocket Shipping Check
  useEffect(() => {
    const checkShipping = async () => {
      if (!/^\d{6}$/.test(deliveryZip) || cart.length === 0) return;

      setIsCheckingShipping(true);
      try {
        const totalWeight = cart.reduce((acc, item) => acc + (0.5 * (item.quantity || 1)), 0);

        const res = await axiosInstance.get(
          `/shiprocket/serviceability?delivery_postcode=${deliveryZip}&weight=${totalWeight}&cod=${paymentMethod === 'cod' ? 1 : 0}`
        );

        if (res.data?.success && res.data.data?.data?.available_courier_companies?.length > 0) {
          const courier = res.data.data.data.available_courier_companies[0];
          setIsServiceable(true);
          setEstimatedDeliveryDays(courier.etd_hours ? Math.ceil(courier.etd_hours / 24) : 4);
        } else {
          setIsServiceable(false);
        }
      } catch (err) {
        console.error("Failed to check serviceability", err);
        setIsServiceable(true);
      } finally {
        setIsCheckingShipping(false);
      }
    };

    const debounce = setTimeout(() => { checkShipping() }, 500);
    return () => clearTimeout(debounce);
  }, [deliveryZip, cart, paymentMethod, cartTotal, usesAddressForm, selectedAddressId, addresses, showNewAddressForm, addressForm.pincode]);

  // Address lookup (guests and signed-in customers share this browser store).
  useEffect(() => {
    const loaded = readStoredAddresses();
    setAddresses(loaded);
    const def = loaded.find((a) => a.isDefault);
    setSelectedAddressId(def ? def.id : loaded[0]?.id || "");
  }, []);

  // A customer who is already signed in with THIS number is confirmed without
  // pressing anything: there is nothing to prove.
  useEffect(() => {
    if (!user?.phone || !mobile) return;
    const signedIn = user.phone.replace(/\D/g, '');
    const entered = fullPhoneDigits(mobile, phoneCountry);
    if (signedIn && entered && signedIn.slice(-10) === entered.slice(-10)) {
      setConfirmedContact({ name: contactName.trim() || 'Customer', digits: entered, email: contactEmail.trim().toLowerCase() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.phone, mobile, phoneCountry]);

  // The address book is also mirrored on the customer profile, so signing in
  // on a fresh browser still restores what was saved last time.
  useEffect(() => {
    if (hydratedFromProfileRef.current || !user) return;
    hydratedFromProfileRef.current = true;
    if (readStoredAddresses().length > 0) return;

    const remote = user.address;
    const book: Address[] = Array.isArray(remote?.book)
      ? remote.book
      : remote && remote.city
        ? [remote as Address]
        : [];
    if (book.length === 0) return;

    writeStoredAddresses(book);
    setAddresses(book);
    const def = book.find((a) => a.isDefault);
    setSelectedAddressId(def ? def.id : book[0].id);
  }, [user]);

  // Prefill the contact + address form from the signed-in customer, but never
  // skip the form itself — the user still sees and confirms every field.
  useEffect(() => {
    if (!user) return;
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
    if (!contactName && fullName) setContactName(fullName);
    if (!mobile && user.phone) setMobile(user.phone);
    if (!customerEmail && user.email && !isSyntheticEmail(user.email)) {
      setCustomerEmail(user.email);
    }
    // The contact step's email is the one the profile is created from, so it
    // starts from the email we already know.
    if (!contactEmail && customerEmail && !isSyntheticEmail(customerEmail)) {
      setContactEmail(customerEmail);
    }
    // The address form itself takes name/phone from step 1, so nothing to prefill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAuthenticated]);

  const normalizeMobile = (value: string) => value.replace(/[^\d+]/g, "");

  const handleMobileChange = (value: string) => {
    const next = normalizeMobile(value);
    setMobile(next);
    setMobileError("");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ivory">
        <Loader2 size={40} className="animate-spin text-gold" />
      </div>
    );
  }

  // begin_checkout is fired from the mount effect above (not from the render
  // body — a side effect in render re-fires on every re-render and inflates
  // the funnel).

  if (cart.length === 0) {
    return (
      <div className="container mx-auto px-6 py-24 text-center min-h-[60vh]">
        <Package size={48} className="text-gray-400 mx-auto mb-4" />
        <h2 className="text-2xl font-playfair font-bold text-deep-purple mb-4">Your cart is empty</h2>
        <p className="text-gray-600 mb-8">Add products to your cart before proceeding to checkout.</p>
        <Link href="/products" className="bg-gold text-deep-purple px-8 py-3 rounded-lg font-bold hover:bg-gold-light transition-colors">
          Browse Products
        </Link>
      </div>
    );
  }

  // Calculate pricing (INR ₹)
  const subtotal = cartTotal;
  const discountAmount = appliedDiscount.percent
    ? (subtotal * appliedDiscount.percent) / 100
    : appliedDiscount.amount;

  // Calculate GST per item
  let gstAmount = 0;
  cart.forEach((item) => {
    const itemPrice = item.price || 0;
    const itemQty = item.quantity || 1;
    const itemTotal = itemPrice * itemQty;
    const itemGstPercent = item.gst !== undefined ? item.gst : 5; // Default to 5% instead of 18%
    const itemGstRate = itemGstPercent / 100;
    const itemDiscount = subtotal > 0 ? (discountAmount * itemTotal) / subtotal : 0;
    const itemTaxable = itemTotal - itemDiscount;
    const itemGst = (itemTaxable * itemGstRate) / (1 + itemGstRate);
    gstAmount += itemGst;
  });

  // Calculate GST on shipping if enabled
  if (SHIPPING_IS_TAXABLE && shippingCharges > 0) {
    const shippingGstPercent = 18;
    const shippingGstRate = shippingGstPercent / 100;
    const shippingGst = (shippingCharges * shippingGstRate) / (1 + shippingGstRate);
    gstAmount += shippingGst;
  }

  const uniqueGstRates = Array.from(new Set(cart.map(item => item.gst !== undefined ? item.gst : 5)));
  const singleGstRate = uniqueGstRates.length === 1 ? uniqueGstRates[0] : null;

  const codCharges = paymentMethod === "cod" ? 50 : 0;
  const finalTotal = subtotal - discountAmount + shippingCharges + codCharges;

  // ---- Address validation ----
  const emailValid = EMAIL_RE.test(customerEmail.trim());
  const pincodeValid = PIN_RE.test(addressForm.pincode.trim());
  const stateValid = INDIAN_STATES.includes(addressForm.state.trim());

  const validateAddressForm = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!addressForm.house.trim()) errors.house = "House / Flat number is required.";
    if (!addressForm.area.trim()) errors.area = "Lane / Street / Road is required.";
    if (!addressForm.city.trim()) errors.city = "City is required.";
    if (!stateValid) errors.state = "Select your state or union territory.";
    if (!addressForm.pincode.trim()) errors.pincode = "PIN code is required.";
    else if (!pincodeValid) errors.pincode = "PIN code must be exactly 6 digits.";
    return errors;
  };

  const formErrors = validateAddressForm();
  // Inline errors appear once a field has been typed into, or after a submit attempt.
  const fieldError = (field: string, value: string) =>
    addressSubmitted || (value || "").trim() !== "" ? formErrors[field] || "" : "";

  // Email lives outside the address form, so it validates on its own.
  const emailError =
    !customerEmail.trim() ? "Email is required for order updates." : !emailValid ? "Enter a valid email address." : "";
  const showEmailError = addressSubmitted || customerEmail.trim() !== "";

  const selectedSavedAddress = addresses.find((a) => a.id === selectedAddressId);

  const formAddressValid = Object.keys(formErrors).length === 0;

  // A saved address is only usable as-is if the backend will accept it: the state
  // decides CGST/SGST vs IGST on the invoice, so an unrecognised one is rejected
  // here rather than silently falling back to IGST after the order is placed.
  const savedAddressValid =
    !!selectedSavedAddress &&
    selectedSavedAddress.city.trim() !== "" &&
    isIndianState(selectedSavedAddress.state) &&
    PIN_RE.test(selectedSavedAddress.zipCode.trim());

  const deliveryAddressValid = usesAddressForm ? formAddressValid : savedAddressValid;

  // The Indian delivery contact, required for a non-Indian order.
  const needsIndianDeliveryContact = phoneCountry.iso !== "in";
  const deliveryContactValid = !needsIndianDeliveryContact || /^[6-9]\d{9}$/.test(deliveryContact);

  const addressValid = deliveryAddressValid && emailValid && deliveryContactValid;

  // The address of record: what the order, invoice, Shiprocket label and admin
  // panel will all be built from.
  const buildFormAddress = (): Address => ({
    id: `addr-form`,
    fullName: contactName.trim() || "Customer",
    addressLine: formatAddressLine(addressForm),
    city: addressForm.city.trim(),
    state: addressForm.state.trim(),
    zipCode: addressForm.pincode.trim(),
    phone: mobile,
    type: addressForm.type,
    isDefault: addresses.length === 0,
    addressLine1: addressForm.house.trim(),
    addressLine2: addressForm.area.trim(),
    landmark: addressForm.landmark.trim(),
    country: "India",
    pincode: addressForm.pincode.trim(),
  });

  const effectiveAddress: Address | null = usesAddressForm
    ? (formAddressValid ? buildFormAddress() : null)
    : (selectedSavedAddress || null);

  // ---- Address book mutations ----
  // Local (this browser) is the source of truth so guests keep their
  // addresses; the same book is mirrored to the customer profile through the
  // existing PUT /auth/profile endpoint so it is still there after a login.
  const syncAddressBook = (next: Address[], selectId: string) => {
    setAddresses(next);
    writeStoredAddresses(next);
    setSelectedAddressId(selectId);
    if (!user) return;
    const chosen = next.find((a) => a.id === selectId) || next[0];
    saveProfile({ address: chosen ? { ...chosen, book: next } : { book: next } }).catch((err) =>
      console.error("Failed to sync the address book", err)
    );
  };

  const resetAddressForm = () => {
    setAddressForm(emptyAddressForm());
    setAddressSubmitted(false);
    setEditingAddressId(null);
    setShowNewAddressForm(false);
  };

  const handleOpenAddAddress = () => {
    setAddressForm(emptyAddressForm());
    setAddressSubmitted(false);
    setEditingAddressId(null);
    setShowNewAddressForm(true);
  };

  const handleEditAddress = (addr: Address) => {
    const { house, area } = splitAddressParts(addr);
    setAddressForm({
      house,
      area,
      landmark: addr.landmark || "",
      city: addr.city || "",
      state: addr.state || "",
      pincode: addr.pincode || addr.zipCode || "",
      type: ADDRESS_TYPES.includes(addr.type as any) ? addr.type : "Home",
      isDefault: !!addr.isDefault,
    });
    setAddressSubmitted(false);
    setEditingAddressId(addr.id);
    setShowNewAddressForm(true);
    window.setTimeout(
      () => document.getElementById("new-address-form")?.scrollIntoView({ behavior: "smooth", block: "center" }),
      60
    );
  };

  const handleDeleteAddress = (id: string) => {
    const next = addresses.filter((a) => a.id !== id);
    let selectId = selectedAddressId;
    if (selectedAddressId === id) {
      selectId = next.find((a) => a.isDefault)?.id || next[0]?.id || "";
    }
    if (editingAddressId === id) resetAddressForm();
    syncAddressBook(next, selectId);
  };

  const handleSetDefault = (id: string) => {
    syncAddressBook(
      addresses.map((a) => ({ ...a, isDefault: a.id === id })),
      selectedAddressId || id
    );
  };

  // Create or update — both use the same six fields.
  const handleSaveAddress = (e: React.FormEvent) => {
    e.preventDefault();
    setAddressSubmitted(true);
    if (Object.keys(formErrors).length > 0) return;

    const editing = editingAddressId ? addresses.find((a) => a.id === editingAddressId) : undefined;
    const others = editing ? addresses.length - 1 : addresses.length;
    const makeDefault = addressForm.isDefault || others === 0;

    const record: Address = {
      id: editing ? editing.id : `addr-${Date.now()}`,
      fullName: (contactName.trim() || editing?.fullName || "Customer").trim(),
      addressLine: formatAddressLine(addressForm),
      city: addressForm.city.trim(),
      state: addressForm.state.trim(),
      zipCode: addressForm.pincode.trim(),
      phone: mobile || editing?.phone || "",
      type: addressForm.type,
      isDefault: makeDefault,
      addressLine1: addressForm.house.trim(),
      addressLine2: addressForm.area.trim(),
      landmark: addressForm.landmark.trim(),
      country: "India",
      pincode: addressForm.pincode.trim(),
    };

    const next = editing
      ? addresses.map((a) =>
          a.id === record.id
            ? record
            : { ...a, isDefault: makeDefault ? false : a.isDefault }
        )
      : [...addresses.map((a) => (makeDefault ? { ...a, isDefault: false } : a)), record];

    syncAddressBook(next, record.id);
    resetAddressForm();
  };

  // Coupon Validation
  const handleApplyCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    setCouponError("");
    const cleanCode = couponCode.trim().toUpperCase();
    if (!cleanCode) return;

    try {
      const res = await axiosInstance.post('/coupons/validate', { code: cleanCode, orderValue: cartTotal });
      const coupon = res.data.data;

      let amount = 0;
      let percent = 0;

      if (coupon.type === 'percentage') {
        percent = coupon.value;
      } else if (coupon.type === 'fixed') {
        amount = coupon.value;
      } else if (coupon.type === 'free_shipping') {
        amount = shippingCharges;
      }

      setAppliedDiscount({ code: cleanCode, amount, percent });
    } catch (error: any) {
      setCouponError(error.response?.data?.error?.message || "Invalid coupon code.");
    }
  };

  // Submit form POST to PayU Hosted Checkout URL
  const postToPayU = (actionUrl: string, params: Record<string, string>) => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = actionUrl;

    Object.keys(params).forEach((key) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = params[key];
      form.appendChild(input);
    });

    document.body.appendChild(form);
    form.submit();
  };

  // Place Order / Pay Action.
  //
  // The customer presses "Continue" under the number, which confirms the
  // contact and opens a checkout-only session. There is no OTP anywhere on
  // this page, regardless of any config or env flag.

  /** The number as it will be stored, used for the confirmation snapshot. */
  const currentDigits = fullPhoneDigits(mobile, phoneCountry);

  /**
   * The contact is confirmed when the NUMBER still matches the snapshot taken
   * when "Continue" was pressed. The number is what the session belongs to, so
   * it is the one thing that decides; a name edit resets the snapshot
   * explicitly (see the name field), while a stray re-render cannot clear it.
   */
  const contactConfirmed =
    confirmedContact !== null && confirmedContact.digits === currentDigits;

  /** The contact is confirmed when "Continue" was pressed. */
  const contactReady = contactConfirmed;

  /**
   * "Continue" - confirm the name, the number and the email, and open the
   * customer session.
   *
   * The session IS the customer profile: the backend creates the profile when
   * the number is new, and opens a long-lived session in this browser. The
   * session is scoped to what this browser created - it never exposes another
   * customer's data, even when the number already belongs to one.
   */
  const handleConfirmContact = async () => {
    if (isConfirmingContact) return;
    setContactError("");
    setContactEmailError("");

    const name = contactName.trim();
    if (name.length < 2) {
      setContactError("Please enter your full name.");
      document.getElementById("checkout-contact")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const digits = nationalDigits(mobile, phoneCountry);
    if (!isValidNational(digits, phoneCountry)) {
      setContactError(
        phoneCountry.iso === "in"
          ? "Please enter a valid 10-digit Indian mobile number."
          : `Please enter a valid ${phoneCountry.digits}-digit ${phoneCountry.name} number.`,
      );
      document.getElementById("checkout-mobile")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const email = contactEmail.trim().toLowerCase();
    if (!email) {
      setContactEmailError("Please enter your email address.");
      document.getElementById("checkout-contact-email")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setContactEmailError("Enter a valid email address.");
      document.getElementById("checkout-contact-email")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setIsConfirmingContact(true);
    try {
      await openSession(name, fullPhoneDigits(mobile, phoneCountry), email, {
        website,
        renderedAt: formRenderedAt.current,
      });
      // The delivery email follows the contact email.
      if (!customerEmail.trim()) setCustomerEmail(email);
      setConfirmedContact({ name, digits: fullPhoneDigits(mobile, phoneCountry), email });
    } catch (err: any) {
      // Axios surfaces a transport failure (offline, blocked request) as a
      // bare "Network Error" - never show that raw string to a customer.
      const serverMessage = err?.response?.data?.error?.message;
      setContactError(
        serverMessage ||
          (err?.response
            ? err.message
            : "We couldn't connect. Please check your internet and try again."),
      );
    } finally {
      setIsConfirmingContact(false);
    }
  };

  const handlePlaceOrder = async () => {
    // A name and a number are the minimum.
    if (!contactName.trim() || contactName.trim().length < 2) {
      setStepError("Please enter your full name.");
      document.getElementById("checkout-contact")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const digits = nationalDigits(mobile, phoneCountry);
    if (!isValidNational(digits, phoneCountry)) {
      setStepError("Please enter a valid mobile number.");
      document.getElementById("checkout-mobile")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (!addressValid || !effectiveAddress) {
      setAddressSubmitted(true);
      if (needsIndianDeliveryContact && !deliveryContactValid) {
        setDeliveryContactError(
          "Please enter a valid 10-digit Indian mobile number for delivery.",
        );
      }
      if (typeof window !== "undefined") {
        const target = !deliveryContactValid
          ? "checkout-delivery-contact"
          : deliveryAddressValid && !emailValid
            ? "checkout-email"
            : "checkout-address";
        document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    if (!isServiceable) {
      alert("Delivery is not available for this pincode.");
      return;
    }

    setIsPlacingOrder(true);
    const selectedAddr = effectiveAddress;

    // The contact was already confirmed by "Continue", which opened the
    // checkout-only session. Nothing to do here.
    if (!contactConfirmed) {
      setStepError("Please confirm your contact details first.");
      document.getElementById("checkout-contact")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    // Save the latest name / email / address against the account before the
    // order is created so the invoice and WhatsApp messages use fresh details.
    try {
      await saveProfile({
        name: contactName,
        email: customerEmail,
        phone: mobile,
        // `book` keeps the whole address book alongside the address of record
        // so it is still available after a fresh login.
        address: { ...selectedAddr, book: addresses },
      });
    } catch (profileErr) {
      // Never block checkout because a profile write failed.
      console.error("Failed to save profile", profileErr);
    }

    // Same keys the order API already expects, plus additive parts the admin
    // panel, customer export and address book read. orders.shipping_address is
    // JSONB, so no schema change is involved.
    const buildAddressPayload = () => ({
      fullName: selectedAddr.fullName,
      addressLine: selectedAddr.addressLine,
      city: selectedAddr.city,
      state: selectedAddr.state,
      zipCode: selectedAddr.zipCode,
      // Same canonical digits as delivery_phone so the jsonb copy stays in
      // sync with the column (the backend also normalises this on write).
      phone: fullPhoneDigits(mobile, phoneCountry),
      addressLine1: selectedAddr.addressLine1 || selectedAddr.addressLine || "",
      addressLine2: selectedAddr.addressLine2 || "",
      landmark: selectedAddr.landmark || "",
      pincode: selectedAddr.pincode || selectedAddr.zipCode || "",
      country: selectedAddr.country || phoneCountry.name,
    });

    const baseCheckoutPayload = {
      items: cart.map(item => ({
        product_id: item.id,
        name: item.name,
        quantity: item.quantity || 1,
        price: item.price,
      })),
      subtotal: subtotal,
      discount: discountAmount,
      shipping_cost: shippingCharges + codCharges,
      tax: gstAmount,
      total: finalTotal,
      notes: orderNotes,
      // The delivery phone Shiprocket receives.
      //
      // For an Indian order this is the customer's own number. For an order
      // from another country it is the Indian delivery contact the customer
      // gave us, because the parcel is delivered inside India. The customer's
      // own number still goes to the order as the contact for WhatsApp and
      // invoices, inside the address jsonb.
      delivery_phone: needsIndianDeliveryContact
        ? `91${deliveryContact}`
        : fullPhoneDigits(mobile, phoneCountry),
      // The customer's own number, for WhatsApp and the invoice.
      customer_phone: fullPhoneDigits(mobile, phoneCountry),
      shipping_address: buildAddressPayload(),
      billing_address: buildAddressPayload()
    };

    try {
      if (paymentMethod === "payu") {
        // Initiate PayU Hosted Checkout on Server
        // NOTE: Cart is NOT cleared here — it's only cleared on the success page
        // after the backend verifies the payment hash and updates order status.
        const response = await axiosInstance.post('/payu/initiate', {
          checkoutPayload: baseCheckoutPayload
        });

        const { payuParams } = response.data.data;

        // Auto submit POST to PayU hosted page (user leaves site)
        const { actionUrl, ...fields } = payuParams;
        postToPayU(actionUrl, fields);
        // Note: setIsPlacingOrder(false) is intentionally NOT called here
        // because the page navigates away immediately after form submit.
      } else {
        // Cash on Delivery — create order and redirect to success page
        const orderData = {
          ...baseCheckoutPayload,
          payment_method: "Cash On Delivery"
        };
        const response = await axiosInstance.post('/orders', orderData);
        const createdOrder = response.data.data;
        // Cart is cleared by success page on load
        router.push(`/checkout/success/${createdOrder.id}`);
      }
    } catch (err: any) {
      console.error("Order processing error", err);
      if (err.response?.status === 401) {
        localStorage.removeItem('meruveda_auth_token');
        localStorage.removeItem('meruveda_user');
        sessionStorage.removeItem('meruveda_auth_token');
        sessionStorage.removeItem('meruveda_user');
        document.cookie = 'meruveda_auth_token=; path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Lax';
        document.cookie = 'mv_customer_session=; path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Lax';
        window.location.href = '/login';
        return;
      }
      alert(err.response?.data?.error?.message || "Failed to process order. Please try again.");
      setIsPlacingOrder(false);
    }
  };

  const inputClass =
    "w-full border border-gray-300 rounded-lg px-4 py-2 outline-none focus:border-gold focus:ring-1 focus:ring-gold/30 transition-all text-sm bg-white text-gray-900 placeholder:text-gray-400";
  const labelClass = "block text-gray-700 font-medium mb-1 text-xs";
  const errorClass = "block text-[11px] text-red-500 font-medium mt-1";

  // Inline address errors — surfaced once a field is typed into or on submit.
  const addrErr = {
    pincode: fieldError("pincode", addressForm.pincode),
    house: fieldError("house", addressForm.house),
    area: fieldError("area", addressForm.area),
    city: fieldError("city", addressForm.city),
    state: fieldError("state", addressForm.state),
  };

  return (
    <div className="container mx-auto px-6 py-12 pb-32 sm:pb-28 md:py-24 md:pb-32">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-8 border-b border-gray-100 pb-4">
        <Link href="/products" className="hover:text-gold">Shop</Link>
        <ChevronRight size={12} />
        <span className="text-deep-purple font-semibold">Checkout</span>
      </div>

      {/* Order Summary is the wider (≈60%) left column on desktop and comes
          first when stacked on mobile. `order` is kept at every breakpoint so
          the DOM order and the visual order never disagree. */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 xl:gap-12 min-w-0">
        {/* Checkout steps — right column (≈40%) on desktop */}
        <div className="order-2 lg:col-span-2 space-y-8 min-w-0">

          {/* STEP 1: CONTACT & WHATSAPP VERIFICATION (shown on EVERY order) */}
          <div id="checkout-contact" className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm scroll-mt-28">
            <h2 className="text-xl font-playfair font-bold text-deep-purple mb-6 flex items-center gap-2">
              <span className="w-6 h-6 bg-deep-purple text-white rounded-full text-xs flex items-center justify-center font-sans">1</span>
              Contact Details
            </h2>

            {/* The contact form. Enter in a text field does nothing - the
                customer presses the Continue pill below. */}
            <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
                <div className="min-w-0">
                  <label className={labelClass}>Full Name</label>
                  <input
                    type="text"
                    required
                    value={contactName}
                    onChange={(e) => {
                      setContactName(e.target.value);
                      setContactError("");
                      // Typing a different name un-confirms the contact.
                      if (confirmedContact && e.target.value.trim() !== confirmedContact.name) {
                        setConfirmedContact(null);
                      }
                    }}
                    className={inputClass}
                    placeholder="Enter your full name"
                  />
                </div>
                <div className="min-w-0">
                  <label className={labelClass}>Mobile Number (WhatsApp)</label>
                  <CountryPhoneField
                    id="checkout-mobile"
                    country={phoneCountry}
                    onCountryChange={(c) => {
                      setPhoneCountry(c);
                      // A different country means a different number: the
                      // confirmation no longer matches.
                      setConfirmedContact(null);
                    }}
                    value={mobile}
                    onValueChange={handleMobileChange}
                    invalid={!!mobileError}
                  />
                  {mobileError && <p className={errorClass}>{mobileError}</p>}
                </div>
              </div>

              {/* The email is part of the CONTACT step: the profile is created
                  from it when the customer presses Continue, and it is where
                  the order confirmation and the invoice go. */}
              <div className="min-w-0">
                <label className={labelClass} htmlFor="checkout-contact-email">
                  Email Address
                </label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    id="checkout-contact-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={contactEmail}
                    onChange={(e) => {
                      setContactEmail(e.target.value);
                      setContactError("");
                      if (
                        confirmedContact &&
                        e.target.value.trim().toLowerCase() !== confirmedContact.email
                      ) {
                        setConfirmedContact(null);
                      }
                    }}
                    className={`${inputClass} pl-9`}
                    placeholder="you@example.com"
                  />
                </div>
                {contactEmailError && (
                  <p className="text-[11px] text-red-500 font-medium mt-1">{contactEmailError}</p>
                )}
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleConfirmContact}
                  disabled={isConfirmingContact}
                  data-contact-confirmed={contactConfirmed ? 'yes' : 'no'}
                  className={`w-full rounded-full py-3.5 text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-60 ${
                    contactConfirmed
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-deep-purple text-white hover:bg-deep-purple/90"
                  }`}
                >
                  {isConfirmingContact ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Confirming...
                    </>
                  ) : contactConfirmed ? (
                    <>
                      <CheckCircle2 size={16} />
                      Contact confirmed
                    </>
                  ) : (
                    "Continue"
                  )}
                </button>
                {contactConfirmed ? (
                  <p className="text-[11px] text-gray-500 text-center">
                    {contactName.trim()} · {formatDisplay(mobile, phoneCountry)}
                  </p>
                ) : (
                  <p className="text-[11px] text-gray-500 text-center">
                    Order updates and your invoice will be sent to this WhatsApp number.
                  </p>
                )}
                {contactError && (
                  <p className="text-[11px] text-red-500 font-medium text-center">{contactError}</p>
                )}
              </div>

              {/* The honeypot. A human never sees this field and never fills
                  it in; a bot fills everything it finds. It is off-screen and
                  hidden from assistive technology on purpose. */}
              <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label htmlFor="checkout-website">Website</label>
                <input
                  id="checkout-website"
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>

              {stepError && <p className="text-[11px] text-red-500 font-medium">{stepError}</p>}

              {/* An order that ships inside India needs an Indian number the
                  parcel can be delivered to. It is required whenever the
                  customer's own country is not India. */}
              {phoneCountry.iso !== "in" && (
                <div className="border border-amber-200 bg-amber-50/60 rounded-xl p-4 space-y-2">
                  <div>
                    <label htmlFor="checkout-delivery-contact" className={labelClass}>
                      Delivery contact number (India)
                    </label>
                    <p className="text-[11px] text-gray-500">
                      We deliver within India, so we need a 10-digit Indian mobile
                      number the parcel can be delivered to. Your own number
                      ({phoneCountry.name}) stays on the order for WhatsApp and
                      invoices.
                    </p>
                  </div>
                  <input
                    id="checkout-delivery-contact"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    required
                    value={deliveryContact}
                    onChange={(e) => {
                      setDeliveryContact(e.target.value.replace(/\D/g, "").slice(0, 10));
                      setDeliveryContactError("");
                    }}
                    placeholder="98765 43210"
                    className={`${inputClass} ${deliveryContactError ? "border-red-400" : ""}`}
                  />
                  {deliveryContactError && <p className={errorClass}>{deliveryContactError}</p>}
                </div>
              )}
            </form>
          </div>

          {/* STEP 2: DELIVERY ADDRESS + EMAIL (always visible and usable) */}
          <div id="checkout-address" className="bg-white p-4 sm:p-6 rounded-2xl border border-gray-100 shadow-sm scroll-mt-28">
            <h2 className="text-xl font-playfair font-bold text-deep-purple mb-6 flex items-center gap-2">
              <span className="w-6 h-6 bg-deep-purple text-white rounded-full text-xs flex items-center justify-center font-sans">2</span>
              Delivery Address &amp; Email
            </h2>

            {/* Saved addresses — selectable cards, never faded or greyed out */}
            {addresses.length > 0 && !showNewAddressForm && (
              <div className="mb-5">
                <p className="text-[11px] font-bold text-deep-purple uppercase tracking-wider mb-3">
                  Saved addresses
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {addresses.map((addr) => {
                    const selected = selectedAddressId === addr.id;
                    return (
                      <div
                        key={addr.id}
                        onClick={() => setSelectedAddressId(addr.id)}
                        className={`p-4 rounded-xl border cursor-pointer transition-all ${
                          selected
                            ? "border-deep-purple ring-1 ring-deep-purple/20 bg-deep-purple/5"
                            : "border-gray-200 bg-white hover:border-gray-300"
                        }`}
                      >
                        <label className="flex items-start gap-2.5 cursor-pointer">
                          <input
                            type="radio"
                            name="selectedAddress"
                            checked={selected}
                            onChange={() => setSelectedAddressId(addr.id)}
                            aria-label={`Deliver to ${addr.fullName}`}
                            className="mt-1 h-4 w-4 accent-[#2E0F36]"
                          />
                          <span className="min-w-0 flex-1 text-xs text-gray-600">
                            <span className="flex flex-wrap items-center gap-1.5 mb-1">
                              <span className="font-bold text-deep-purple text-sm">{addr.fullName}</span>
                              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-ivory border border-stone-100 text-deep-purple/80">
                                {addr.type || "Home"}
                              </span>
                              {addr.isDefault && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gold/15 text-gold border border-gold/30">
                                  <Star size={9} /> Default
                                </span>
                              )}
                            </span>
                            <span className="block leading-relaxed">{addr.addressLine}</span>
                            <span className="block leading-relaxed">
                              {addr.city}, {addr.state} - {addr.zipCode}
                            </span>
                            {addr.phone && <span className="block mt-1 text-gray-500">{addr.phone}</span>}
                          </span>
                        </label>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pl-6 pt-2 border-t border-gray-100">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditAddress(addr);
                            }}
                            className="text-[11px] font-bold text-deep-purple hover:text-gold flex items-center gap-1"
                          >
                            <Pencil size={11} /> Edit
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteAddress(addr.id);
                            }}
                            className="text-[11px] font-bold text-gray-500 hover:text-red-500 flex items-center gap-1"
                          >
                            <Trash2 size={11} /> Delete
                          </button>
                          {!addr.isDefault && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSetDefault(addr.id);
                              }}
                              className="text-[11px] font-bold text-gold hover:text-gold-light"
                            >
                              Set as default
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={handleOpenAddAddress}
                  className="mt-4 text-xs text-gold hover:text-gold-light font-bold flex items-center gap-1"
                >
                  <Plus size={14} /> Add New Address
                </button>
              </div>
            )}

            {/* Add / edit address form — six separate fields, never merged */}
            {(addresses.length === 0 || showNewAddressForm) && (
              <form
                id="new-address-form"
                onSubmit={handleSaveAddress}
                className="space-y-4 border border-gray-100 bg-gray-50/60 p-4 sm:p-5 rounded-xl scroll-mt-28"
              >
                <h4 className="flex items-center gap-1.5 text-xs font-bold text-deep-purple uppercase tracking-wider">
                  <MapPin size={13} className="text-gold" />
                  {editingAddressId ? "Edit delivery address" : "Add a new address"}
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass} htmlFor="address-house">House / Flat Number</label>
                    <input
                      id="address-house"
                      type="text"
                      autoComplete="address-line1"
                      value={addressForm.house}
                      onChange={(e) => setAddressForm((p) => ({ ...p, house: e.target.value }))}
                      className={inputClass}
                      placeholder="e.g. House No. 12, Flat 301"
                    />
                    {addrErr.house && <p className={errorClass}>{addrErr.house}</p>}
                  </div>

                  <div>
                    <label className={labelClass} htmlFor="address-area">Lane / Street / Road</label>
                    <input
                      id="address-area"
                      type="text"
                      autoComplete="address-line2"
                      value={addressForm.area}
                      onChange={(e) => setAddressForm((p) => ({ ...p, area: e.target.value }))}
                      className={inputClass}
                      placeholder="e.g. MG Road, Lane 2"
                    />
                    {addrErr.area && <p className={errorClass}>{addrErr.area}</p>}
                  </div>

                  <div>
                    <label className={labelClass} htmlFor="address-landmark">Landmark (Optional)</label>
                    <input
                      id="address-landmark"
                      type="text"
                      value={addressForm.landmark}
                      onChange={(e) => setAddressForm((p) => ({ ...p, landmark: e.target.value }))}
                      className={inputClass}
                      placeholder="e.g. Near City Mall"
                    />
                  </div>

                  <div>
                    <label className={labelClass} htmlFor="address-city">City</label>
                    <input
                      id="address-city"
                      type="text"
                      autoComplete="address-level2"
                      value={addressForm.city}
                      onChange={(e) => setAddressForm((p) => ({ ...p, city: e.target.value }))}
                      className={inputClass}
                      placeholder="Enter your city"
                    />
                    {addrErr.city && <p className={errorClass}>{addrErr.city}</p>}
                  </div>

                  <div>
                    <label className={labelClass} htmlFor="checkout-state">State / Union Territory</label>
                    <StateSelect
                      id="checkout-state"
                      value={addressForm.state}
                      onChange={(state) => setAddressForm((p) => ({ ...p, state }))}
                      className={inputClass}
                      invalid={!!addrErr.state}
                    />
                    {addrErr.state && <p className={errorClass}>{addrErr.state}</p>}
                  </div>

                  <div>
                    <label className={labelClass} htmlFor="address-pincode">PIN Code</label>
                    <input
                      id="address-pincode"
                      type="text"
                      inputMode="numeric"
                      autoComplete="postal-code"
                      maxLength={6}
                      value={addressForm.pincode}
                      onChange={(e) =>
                        setAddressForm((p) => ({ ...p, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) }))
                      }
                      className={inputClass}
                      placeholder="Enter 6-digit PIN code"
                    />
                    {addrErr.pincode && <p className={errorClass}>{addrErr.pincode}</p>}
                  </div>
                </div>

                <div className="flex flex-wrap items-start justify-between gap-4 pt-1">
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold text-deep-purple uppercase tracking-wider">Address type</p>
                    <div className="flex flex-wrap gap-4">
                      {ADDRESS_TYPES.map((type) => (
                        <label key={type} className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                          <input
                            type="radio"
                            name="newAddressType"
                            checked={addressForm.type === type}
                            onChange={() => setAddressForm((p) => ({ ...p, type }))}
                            className="accent-[#2E0F36]"
                          />
                          {type}
                        </label>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer pt-4">
                    <input
                      type="checkbox"
                      checked={addressForm.isDefault}
                      onChange={(e) => setAddressForm((p) => ({ ...p, isDefault: e.target.checked }))}
                      className="h-4 w-4 accent-[#2E0F36]"
                    />
                    Set as default delivery address
                  </label>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  {addresses.length > 0 && (
                    <button
                      type="button"
                      onClick={resetAddressForm}
                      className="px-4 py-2 border border-gray-200 bg-white text-xs font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    className="bg-deep-purple text-white px-5 py-2 text-xs font-bold rounded-lg hover:bg-deep-purple/90 transition-colors"
                  >
                    Save Address
                  </button>
                </div>
              </form>
            )}

            {/* Email — kept separate from the address form */}
            <div id="checkout-email" className="mt-6 pt-5 border-t border-gray-100 scroll-mt-28">
              <label className={labelClass} htmlFor="checkout-email-input">
                <span className="inline-flex items-center gap-1">
                  <Mail size={12} /> Email (for order updates)
                </span>
              </label>
              <input
                id="checkout-email-input"
                type="email"
                autoComplete="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className={inputClass}
                placeholder="Enter your email address"
              />
              {showEmailError && emailError ? <p className={errorClass}>{emailError}</p> : null}
              <p className="text-[11px] text-gray-400 mt-1.5">
                Order confirmation and tracking updates are sent here.
              </p>
            </div>
          </div>

          {/* STEP 3: PAYMENT METHOD */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
            <h2 className="text-xl font-playfair font-bold text-deep-purple mb-6 flex items-center gap-2">
              <span className="w-6 h-6 bg-deep-purple text-white rounded-full text-xs flex items-center justify-center font-sans">3</span>
              Payment Method
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              {/* Pay Online Option */}
              <button
                type="button"
                onClick={() => setPaymentMethod("payu")}
                className={`p-5 border rounded-2xl flex flex-col items-start gap-3 transition-all text-left relative overflow-hidden ${paymentMethod === "payu"
                  ? "border-gold bg-gold/5 ring-1 ring-gold/30"
                  : "border-gray-200 hover:border-gray-300 bg-white"
                  }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <CreditCard size={22} className={paymentMethod === "payu" ? "text-gold" : "text-gray-400"} />
                    <span className="font-bold text-sm text-deep-purple">Pay Online (via PayU)</span>
                  </div>
                  <input
                    type="radio"
                    name="paymentMethod"
                    checked={paymentMethod === "payu"}
                    onChange={() => setPaymentMethod("payu")}
                    className="accent-gold"
                  />
                </div>
                <p className="text-xs text-gray-500">
                  Pay securely via Credit/Debit Cards, UPI, NetBanking, and Wallets on PayU's encrypted payment page.
                </p>
                <div className="flex items-center gap-1.5 text-[10px] text-gray-400 font-semibold pt-1">
                  <ShieldCheck size={12} className="text-green-600" /> 256-bit SSL Encrypted by PayU
                </div>
              </button>

              {/* Cash on Delivery Option */}
              <button
                type="button"
                onClick={() => setPaymentMethod("cod")}
                className={`p-5 border rounded-2xl flex flex-col items-start gap-3 transition-all text-left relative overflow-hidden ${paymentMethod === "cod"
                  ? "border-gold bg-gold/5 ring-1 ring-gold/30"
                  : "border-gray-200 hover:border-gray-300 bg-white"
                  }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <Truck size={22} className={paymentMethod === "cod" ? "text-gold" : "text-gray-400"} />
                    <span className="font-bold text-sm text-deep-purple">Cash on Delivery</span>
                  </div>
                  <input
                    type="radio"
                    name="paymentMethod"
                    checked={paymentMethod === "cod"}
                    onChange={() => setPaymentMethod("cod")}
                    className="accent-gold"
                  />
                </div>
                <p className="text-xs text-gray-500">
                  Pay cash at your doorstep upon order delivery. Additional ₹50 COD handling fee applies.
                </p>
              </button>
            </div>
          </div>

          {/* STEP 4: ORDER NOTES */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
            <h3 className="text-sm font-bold text-deep-purple mb-2">Order Notes (Optional)</h3>
            <textarea
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              placeholder="Special instructions for delivery (e.g. leave at door, call before delivery)..."
              className="w-full border border-gray-200 rounded-xl p-3 text-xs outline-none focus:border-gold"
              rows={3}
            />
          </div>
        </div>

        {/* Order Summary — left column (≈60%) on desktop, first when stacked */}
        <div className="order-1 lg:col-span-3 space-y-6 min-w-0">
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm sticky top-24">
            <h3 className="text-lg font-playfair font-bold text-deep-purple mb-4 border-b border-gray-100 pb-3">
              Order Summary
            </h3>

            {/* Cart Items List */}
            <div className="max-h-60 overflow-y-auto space-y-3 mb-6 pr-1">
              {cart.map((item) => {
                const qty = item.quantity || 1;
                const isRemoving = removingId === item.id;
                return (
                  <div key={item.id} className="flex gap-3 text-xs">
                    <div className="w-12 h-12 bg-ivory rounded-lg overflow-hidden shrink-0 border border-gray-100 flex items-center justify-center font-bold text-gold">
                      {item.name ? item.name.substring(0, 2).toUpperCase() : 'MV'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-deep-purple truncate">{item.name}</p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="inline-flex items-center border border-gray-200 rounded-lg overflow-hidden">
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.id, qty - 1)}
                            disabled={isRemoving}
                            aria-label={`Decrease quantity of ${item.name}`}
                            className="px-2 py-1 text-gray-600 hover:bg-gray-100 disabled:opacity-40 font-bold leading-none"
                          >
                            −
                          </button>
                          <span className="px-2 font-bold text-deep-purple min-w-6 text-center" aria-live="polite">{qty}</span>
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.id, qty + 1)}
                            disabled={isRemoving}
                            aria-label={`Increase quantity of ${item.name}`}
                            className="px-2 py-1 text-gray-600 hover:bg-gray-100 disabled:opacity-40 font-bold leading-none"
                          >
                            +
                          </button>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item.id)}
                          disabled={isRemoving}
                          aria-label={`Remove ${item.name} from cart`}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-red-500 disabled:opacity-40 transition-colors"
                        >
                          {isRemoving ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Trash2 size={12} />
                          )}
                          {isRemoving ? "Removing…" : "Remove"}
                        </button>
                      </div>
                    </div>
                    <p className="font-bold text-deep-purple whitespace-nowrap">₹{((item.price || 0) * qty).toFixed(2)}</p>
                  </div>
                );
              })}
            </div>

            {/* Coupon Code Section */}
            <form onSubmit={handleApplyCoupon} className="mb-6">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Have a promo code?</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  placeholder="COUPON CODE"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-xs outline-none uppercase font-mono focus:border-gold"
                />
                <button
                  type="submit"
                  className="bg-deep-purple text-white px-4 py-1.5 text-xs font-bold rounded-lg hover:bg-deep-purple/90"
                >
                  Apply
                </button>
              </div>
              {appliedDiscount.code && (
                <p className="text-[11px] text-green-600 mt-1 font-semibold">
                  Applied: {appliedDiscount.code} (-₹{discountAmount.toFixed(2)})
                </p>
              )}
              {couponError && (
                <p className="text-[11px] text-red-500 mt-1 font-medium">{couponError}</p>
              )}
            </form>

            {/* Pricing Breakdown */}
            <div className="space-y-2.5 text-xs border-t border-gray-100 pt-4 mb-6">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span>₹{subtotal.toFixed(2)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-green-600 font-medium">
                  <span>Discount</span>
                  <span>-₹{discountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-600">
                <span>Shipping Fee</span>
                <span>{shippingCharges === 0 ? <span className="text-green-600 font-bold">FREE</span> : `₹${shippingCharges.toFixed(2)}`}</span>
              </div>
              {paymentMethod === "cod" && (
                <div className="flex justify-between text-amber-700 font-medium">
                  <span>COD Handling Fee</span>
                  <span>₹50.00</span>
                </div>
              )}

              {(() => {
                const selectedAddr = effectiveAddress;
                const isIntraState = selectedAddr?.state ? isRajasthan(selectedAddr.state) : true;

                if (isIntraState) {
                  return (
                    <>
                      <div className="flex justify-between text-gray-500 text-[11px]">
                        <span>CGST (Included)</span>
                        <span>₹{(gstAmount / 2).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-gray-500 text-[11px]">
                        <span>SGST (Included)</span>
                        <span>₹{(gstAmount / 2).toFixed(2)}</span>
                      </div>
                    </>
                  );
                } else {
                  return (
                    <div className="flex justify-between text-gray-500 text-[11px]">
                      <span>IGST (Included)</span>
                      <span>₹{gstAmount.toFixed(2)}</span>
                    </div>
                  );
                }
              })()}
              <div className="flex justify-between font-bold text-base text-deep-purple border-t border-gray-100 pt-3">
                <span>Total Amount</span>
                <span>₹{finalTotal.toFixed(2)}</span>
              </div>
            </div>

            {/* Submit Action. The button is disabled until the contact and the
                address are confirmed, and the reason is spelled out below it
                - a grey button with no explanation is the worst of both. */}
            {(() => {
              const blockedReason = !isServiceable
                ? "This pincode is not serviceable yet."
                : !contactReady
                  ? "Confirm your contact details to continue"
                  : !deliveryAddressValid
                    ? "Select a delivery address"
                    : !emailValid
                      ? "Enter a valid email to continue"
                      : "";
              return (
                <>
                  <button
                    onClick={handlePlaceOrder}
                    disabled={isPlacingOrder || Boolean(blockedReason)}
                    className="w-full bg-gold text-deep-purple font-bold py-3.5 rounded-xl hover:bg-gold-light transition-all flex items-center justify-center gap-2 text-sm shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isPlacingOrder ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Processing...
                      </>
                    ) : !deliveryAddressValid ? (
                      "Complete address to continue"
                    ) : !emailValid ? (
                      "Enter a valid email to continue"
                    ) : paymentMethod === "payu" ? (
                      `Pay Now (₹${finalTotal.toFixed(2)})`
                    ) : (
                      `Place Order (₹${finalTotal.toFixed(2)})`
                    )}
                  </button>

                  {blockedReason && (
                    <p className="text-[11px] text-amber-600 font-medium text-center mt-2">
                      {blockedReason}
                    </p>
                  )}
                </>
              );
            })()}

            {!addressValid && (
              <p className="text-[11px] text-gray-400 text-center mt-2">
                {!deliveryAddressValid
                  ? "Choose a saved address or complete every required address field."
                  : "Enter a valid email so we can send order updates."}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
