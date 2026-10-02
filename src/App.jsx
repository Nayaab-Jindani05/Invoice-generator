import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { Analytics } from "@vercel/analytics/react";
import "./App.css";

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
const STORE_KEY = "invoezy:v1";
const newItem = () => ({ id: crypto.randomUUID(), description: "", quantity: "1", rate: "" });

const num = (v) => Math.max(parseFloat(v) || 0, 0);
const inr = (paise) =>
  "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const prettyDate = (iso) =>
  iso ? new Date(iso + "T00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";

// All money math is done in paise (integers) to avoid floating-point drift.
export function calculateTotals(items, discount, discountType, gstRate, gstMode) {
  const lines = items.map((it) => Math.round(num(it.quantity) * num(it.rate) * 100));
  const subtotal = lines.reduce((a, b) => a + b, 0);
  const rawDiscount =
    discountType === "percent" ? Math.round((subtotal * Math.min(num(discount), 100)) / 100) : Math.round(num(discount) * 100);
  const discountApplied = Math.min(rawDiscount, subtotal);
  const taxable = subtotal - discountApplied;
  const gst = Math.round((taxable * num(gstRate)) / 100);
  const cgst = Math.floor(gst / 2);
  const sgst = gst - cgst;
  const exact = taxable + gst;
  const total = Math.round(exact / 100) * 100;
  return { lines, subtotal, discountApplied, taxable, gst, cgst, sgst, roundOff: total - exact, total, gstMode };
}

function Field({ label, error, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && <small className="error">{error}</small>}
    </label>
  );
}

function App() {
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch {
      return {};
    }
  })();

  const [business, setBusiness] = useState(saved.business || { name: "", email: "", phone: "", address: "", gstin: "" });
  const [customer, setCustomer] = useState({ name: "", email: "", address: "", gstin: "" });
  const [invoice, setInvoice] = useState({
    number: saved.nextNumber || "INV-001",
    date: new Date().toISOString().split("T")[0],
    dueDate: "",
    discount: "",
    discountType: "amount",
    gst: "0",
    gstMode: "split",
    notes: "Thank you for your business!",
  });
  const [items, setItems] = useState([newItem()]);
  const [downloading, setDownloading] = useState(false);
  const [scale, setScale] = useState(1);

  const previewRef = useRef(null);
  const stageRef = useRef(null);
  const [invoiceHeight, setInvoiceHeight] = useState(1123);

  // Remember business details between visits
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ business, nextNumber: saved.nextNumber }));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business]);

  // Scale the fixed-width A4 invoice to fit its container (keeps PDF output identical on every screen)
  useLayoutEffect(() => {
    const fit = () => {
      if (!stageRef.current || !previewRef.current) return;
      setScale(Math.min(1, stageRef.current.clientWidth / 794));
      setInvoiceHeight(previewRef.current.offsetHeight);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stageRef.current);
    ro.observe(previewRef.current);
    return () => ro.disconnect();
  }, []);

  const setB = (e) => setBusiness((p) => ({ ...p, [e.target.name]: e.target.value }));
  const setC = (e) => setCustomer((p) => ({ ...p, [e.target.name]: e.target.value }));
  const setI = (e) => setInvoice((p) => ({ ...p, [e.target.name]: e.target.value }));
  const updateItem = (id, field, value) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)));
  const removeItem = (id) => setItems((prev) => (prev.length === 1 ? prev : prev.filter((it) => it.id !== id)));

  const t = calculateTotals(items, invoice.discount, invoice.discountType, invoice.gst, invoice.gstMode);
  const gstinError = (v) => (v && !GSTIN_RE.test(v.toUpperCase()) ? "GSTIN should be 15 characters, e.g. 27ABCDE1234F1Z5" : "");

  const downloadPDF = async () => {
    setDownloading(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
      const canvas = await html2canvas(previewRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        onclone: (doc) => {
          const wrap = doc.getElementById("invoice-preview").parentElement;
          wrap.style.transform = "none";
        },
      });
      const pdf = new jsPDF("p", "mm", "a4");
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgH = (canvas.height * pageW) / canvas.width;
      const img = canvas.toDataURL("image/jpeg", 0.95);

      let y = 0;
      let remaining = imgH;
      pdf.addImage(img, "JPEG", 0, y, pageW, imgH);
      while ((remaining -= pageH) > 1) {
        y -= pageH;
        pdf.addPage();
        pdf.addImage(img, "JPEG", 0, y, pageW, imgH);
      }
      pdf.save(`${(invoice.number || "invoice").replace(/[\\/:*?"<>|]/g, "-")}.pdf`);

      // Suggest the next invoice number next time
      const m = invoice.number.match(/^(.*?)(\d+)$/);
      if (m) {
        const next = m[1] + String(Number(m[2]) + 1).padStart(m[2].length, "0");
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify({ business, nextNumber: next }));
        } catch {}
      }
    } catch (e) {
      console.error(e);
      alert("Couldn't create the PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <Analytics />
      <div className="app">
        <header className="header">
          <div className="brand">
            <img src="/favicon.svg" alt="InvoEzy logo" className="logo" />
            <div>
              <h1>InvoEzy</h1>
              <p>Fill in the details, download a clean GST invoice.</p>
            </div>
          </div>
        </header>

        <main className="container">
          <div className="form-col">
            <section className="card">
              <h2>Your business</h2>
              <Field label="Business name">
                <input name="name" value={business.name} onChange={setB} autoComplete="organization" />
              </Field>
              <div className="two">
                <Field label="Email">
                  <input type="email" name="email" value={business.email} onChange={setB} />
                </Field>
                <Field label="Phone">
                  <input type="tel" name="phone" value={business.phone} onChange={setB} />
                </Field>
              </div>
              <Field label="Address">
                <textarea name="address" value={business.address} onChange={setB} />
              </Field>
              <Field label="GSTIN (optional)" error={gstinError(business.gstin)}>
                <input name="gstin" value={business.gstin} onChange={(e) => setB({ target: { name: "gstin", value: e.target.value.toUpperCase() } })} maxLength={15} />
              </Field>
            </section>

            <section className="card">
              <h2>Bill to</h2>
              <Field label="Customer name">
                <input name="name" value={customer.name} onChange={setC} />
              </Field>
              <Field label="Email">
                <input type="email" name="email" value={customer.email} onChange={setC} />
              </Field>
              <Field label="Address">
                <textarea name="address" value={customer.address} onChange={setC} />
              </Field>
              <Field label="GSTIN (optional)" error={gstinError(customer.gstin)}>
                <input name="gstin" value={customer.gstin} onChange={(e) => setC({ target: { name: "gstin", value: e.target.value.toUpperCase() } })} maxLength={15} />
              </Field>
            </section>

            <section className="card">
              <h2>Invoice details</h2>
              <Field label="Invoice number">
                <input name="number" value={invoice.number} onChange={setI} />
              </Field>
              <div className="two">
                <Field label="Invoice date">
                  <input type="date" name="date" value={invoice.date} onChange={setI} />
                </Field>
                <Field label="Due date">
                  <input type="date" name="dueDate" min={invoice.date} value={invoice.dueDate} onChange={setI} />
                </Field>
              </div>
            </section>

            <section className="card">
              <h2>Items</h2>
              {items.map((item) => (
                <div className="item-row" key={item.id}>
                  <input aria-label="Item or service" placeholder="Item or service" value={item.description} onChange={(e) => updateItem(item.id, "description", e.target.value)} />
                  <input aria-label="Quantity" inputMode="decimal" placeholder="Qty" value={item.quantity} onChange={(e) => updateItem(item.id, "quantity", e.target.value)} />
                  <input aria-label="Rate" inputMode="decimal" placeholder="Rate" value={item.rate} onChange={(e) => updateItem(item.id, "rate", e.target.value)} />
                  <button type="button" className="remove" aria-label="Remove item" onClick={() => removeItem(item.id)}>
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="secondary" onClick={() => setItems((p) => [...p, newItem()])}>
                + Add item
              </button>
            </section>

            <section className="card">
              <h2>Discount and GST</h2>
              <div className="two">
                <Field label="Discount">
                  <input inputMode="decimal" name="discount" value={invoice.discount} onChange={setI} />
                </Field>
                <Field label="Discount type">
                  <select name="discountType" value={invoice.discountType} onChange={setI}>
                    <option value="amount">Amount (₹)</option>
                    <option value="percent">Percent (%)</option>
                  </select>
                </Field>
              </div>
              <div className="two">
                <Field label="GST rate">
                  <select name="gst" value={invoice.gst} onChange={setI}>
                    <option value="0">No GST</option>
                    {[5, 12, 18, 28].map((r) => (
                      <option key={r} value={r}>
                        {r}%
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Sale type">
                  <select name="gstMode" value={invoice.gstMode} onChange={setI}>
                    <option value="split">Same state (CGST + SGST)</option>
                    <option value="igst">Other state (IGST)</option>
                  </select>
                </Field>
              </div>
              <Field label="Notes">
                <textarea name="notes" value={invoice.notes} onChange={setI} />
              </Field>
            </section>
          </div>

          <aside className="preview-col">
            <div className="actions">
              <button type="button" className="download" onClick={downloadPDF} disabled={downloading}>
                {downloading ? "Creating PDF…" : "Download PDF"}
              </button>
            </div>
            <div className="stage" ref={stageRef} style={{ height: invoiceHeight * scale }}>
              <div className="scaler" style={{ transform: `scale(${scale})` }}>
                <div id="invoice-preview" className="invoice" ref={previewRef}>
                  <div className="invoice-top">
                    <div>
                      <h1>Invoice</h1>
                      <p className="biz-name">{business.name || "Your business"}</p>
                      {business.address && <p>{business.address}</p>}
                      {business.email && <p>{business.email}</p>}
                      {business.phone && <p>{business.phone}</p>}
                      {business.gstin && <p>GSTIN: {business.gstin}</p>}
                    </div>
                    <dl className="invoice-meta">
                      <dt>Invoice no.</dt>
                      <dd>{invoice.number}</dd>
                      <dt>Date</dt>
                      <dd>{prettyDate(invoice.date)}</dd>
                      {invoice.dueDate && (
                        <>
                          <dt>Due</dt>
                          <dd>{prettyDate(invoice.dueDate)}</dd>
                        </>
                      )}
                    </dl>
                  </div>

                  <div className="bill-to">
                    <h3>Bill to</h3>
                    <p className="biz-name">{customer.name || "Customer name"}</p>
                    {customer.address && <p>{customer.address}</p>}
                    {customer.email && <p>{customer.email}</p>}
                    {customer.gstin && <p>GSTIN: {customer.gstin}</p>}
                  </div>

                  <table>
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th className="r">Qty</th>
                        <th className="r">Rate</th>
                        <th className="r">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, i) => (
                        <tr key={item.id}>
                          <td>{item.description || "Item or service"}</td>
                          <td className="r">{num(item.quantity)}</td>
                          <td className="r">{inr(Math.round(num(item.rate) * 100))}</td>
                          <td className="r">{inr(t.lines[i])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="totals">
                    <p><span>Subtotal</span><span>{inr(t.subtotal)}</span></p>
                    {t.discountApplied > 0 && <p><span>Discount</span><span>− {inr(t.discountApplied)}</span></p>}
                    {num(invoice.gst) > 0 &&
                      (invoice.gstMode === "split" ? (
                        <>
                          <p><span>CGST ({num(invoice.gst) / 2}%)</span><span>{inr(t.cgst)}</span></p>
                          <p><span>SGST ({num(invoice.gst) / 2}%)</span><span>{inr(t.sgst)}</span></p>
                        </>
                      ) : (
                        <p><span>IGST ({num(invoice.gst)}%)</span><span>{inr(t.gst)}</span></p>
                      ))}
                    {t.roundOff !== 0 && <p><span>Round off</span><span>{t.roundOff < 0 ? "− " : ""}{inr(Math.abs(t.roundOff))}</span></p>}
                    <p className="grand-total"><span>Total</span><span>{inr(t.total)}</span></p>
                  </div>

                  {invoice.notes && <div className="invoice-footer">{invoice.notes}</div>}
                </div>
              </div>
            </div>
          </aside>
        </main>
      </div>
    </>
  );
}

export default App;