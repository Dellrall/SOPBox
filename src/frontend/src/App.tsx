import { useEffect, useMemo, useRef, useState } from 'react';
import './styles.css';
import './theme.css';
import { LoginPage } from './components/LoginPage';
import { Sidebar } from './components/Sidebar';
import { Field, Stat, DeliveryTable, badge } from './components/Shared';
import type { Role, Page, Product, Line, Delivery, ApiCheck } from './types';
import { UserManagement } from './components/UserManagement';

import type {
  StaffAccount,
} from './types';

import {
  DEFAULT_STAFF_PERMISSIONS,
} from './types';


const seedProducts:Product[] = [
  {id:'frozen-sausage',name:'Frozen sausage',category:'Frozen',base_unit:'pcs',temp_min_c:-20,temp_max_c:-10},
  {id:'chocolate-ball',name:'Chocolate ball',category:'Dessert',base_unit:'pcs',temp_min_c:-10,temp_max_c:0},
  {id:'fries-tray',name:'Fries tray',category:'Sides',base_unit:'pcs',temp_min_c:null,temp_max_c:null,pack_units:[{unit:'bdl',base_qty:250}]},
  {id:'hot-dog-box',name:'Hot dog box',category:'Buns',base_unit:'pcs',temp_min_c:null,temp_max_c:null,pack_units:[{unit:'bdl',base_qty:100}]},
  {id:'nugget',name:'Nugget',category:'Frozen',base_unit:'packet',temp_min_c:null,temp_max_c:null,pack_units:[{unit:'box',base_qty:12}]}
];
const initialRecords:Delivery[] = [
  {id:'RC-2026-001',supplier:'FreshMart Supplies',po:'PO-10024',invoice:'INV-4402',createdAt:'21 Oct 2026, 09:42',status:'Pending Approval',issues:['Frozen sausage: temperature -6°C outside -20°C to -10°C'],lines:[],decision:''},
  {id:'RC-2026-002',supplier:'Golden Harvest Foods',po:'PO-10025',invoice:'INV-4403',createdAt:'20 Oct 2026, 14:16',status:'Passed',issues:[],lines:[]},
  {id:'RC-2026-003',supplier:'Daily Fresh Trading',po:'PO-10026',invoice:'INV-4404',createdAt:'19 Oct 2026, 11:08',status:'Accepted',issues:['Quantity mismatch reviewed'],lines:[],decision:'Accepted by manager'}
];
const steps=['Delivery details','Upload document','Verify extracted data','Inspect items','Review & submit'];
function uid(){return Math.random().toString(36).slice(2,9)}
function makeLine(p:Product):Line{return {id:uid(),product_id:p.id,name:p.name,quantity:1,unit:p.base_unit,expected_base_qty:null,temp_c:'',condition:'Normal',remarks:'',photoName:''}}
async function api<T>(path:string,options?:RequestInit):Promise<T>{const res=await fetch(path,options);if(!res.ok)throw new Error(`API ${res.status}`);return res.json() as Promise<T>}
function fileToBase64(file:File):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error('Unable to read file'));reader.readAsDataURL(file)})}

export default function App(){
 const [currentUser,setCurrentUser]=useState<{username:string;role:Role}|null>(null);
 const [accounts, setAccounts] = useState<StaffAccount[]>([
  {
    id: 'admin-1',
    username: 'admin',
    password: 'SopBoxDemo2026!',
    role: 'admin',
    active: true,
    permissions: [],
  },
  {
    id: 'staff-1',
    username: 'staff',
    password: 'StaffDemo2026!',
    role: 'employee',
    active: true,
    permissions: [...DEFAULT_STAFF_PERMISSIONS],
  },
]);

 const role:Role=currentUser?.role||'employee';
 const [page,setPage]=useState<Page>('dashboard');
 const [products,setProducts]=useState<Product[]>(seedProducts);
 const [backend,setBackend]=useState(false);
 const [records,setRecords]=useState<Delivery[]>(initialRecords);
 const [search,setSearch]=useState('');
 const [selected,setSelected]=useState<Delivery|null>(null);
 const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
 const [step,setStep]=useState(0);
 const [supplier,setSupplier]=useState('FreshMart Supplies');
 const [po,setPo]=useState('PO-10027');
 const [invoice,setInvoice]=useState('INV-4405');
 const [document,setDocument]=useState<File|null>(null);
 const [documentPreview, setDocumentPreview] = useState('');

useEffect(() => {
  if (!document) {
    setDocumentPreview('');
    return;
  }

  const url = URL.createObjectURL(document);
  setDocumentPreview(url);

  return () => URL.revokeObjectURL(url);
}, [document]);

 const [lines,setLines]=useState<Line[]>([]);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [demoMode,setDemoMode]=useState(false);
 const [lastResult,setLastResult]=useState<Delivery|null>(null);
 const inputRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{api<Product[]>('/api/products').then(data=>{setProducts(data);setBackend(true)}).catch(()=>setBackend(false))},[]);
 const filtered=useMemo(()=>records.filter(r=>[r.id,r.supplier,r.po,r.status].join(' ').toLowerCase().includes(search.toLowerCase())),[records,search]);
 const pending=records.filter(r=>r.status==='Pending Approval').length;
 const failed=records.filter(r=>r.issues.length>0).length;
 const navItems:{key:Page;label:string;admin?:boolean}[]=[{key:'dashboard',label:'Dashboard'},{key:'receiving',label:'Receiving Check'},{key:'records',label:'Delivery Records'},{key:'products',label:'Products & SOP'},{key:'approvals',label:'Approvals',admin:true},{key:'activity',label:'Activity Logs',admin:true},{key:'users',label:'User Management',admin:true}];
 const [mobileOpen, setMobileOpen] = useState(false);
 
 function handleCreateStaff(username: string, password: string): string {
  if (!username || password.length < 8) {
    return 'Username is required and password must be at least 8 characters.';
  }

  if (accounts.some(a =>
    a.username.toLowerCase() === username.toLowerCase()
  )) {
    return 'Username already exists.';
  }

  setAccounts(prev => [
    ...prev,
    {
      id: crypto.randomUUID(),
      username,
      password,
      role: 'employee',
      active: true,
      permissions: [...DEFAULT_STAFF_PERMISSIONS],
    },
  ]);

  return 'Staff account created successfully.';
}

function handleUpdateStaff(updated: StaffAccount) {
  if (updated.role === 'admin') return;

  const name = updated.username.trim();

  if (!name || accounts.some(a =>
    a.id !== updated.id &&
    a.username.toLowerCase() === name.toLowerCase()
  )) {
    window.alert('Username is empty or already exists.');
    return;
  }

  setAccounts(prev =>
    prev.map(a =>
      a.id === updated.id
        ? { ...updated, username: name }
        : a
    )
  );
}

function handleRemoveStaff(id: string) {
  setAccounts(prev =>
    prev.filter(a => a.id !== id || a.role === 'admin')
  );
}

 function navigate(p: Page) {
  if (role === 'admin') {
    setPage(p);
    setMessage('');
    setSelected(null);
    return;
  }

  const account = accounts.find(
    a => a.username === currentUser?.username
  );

  if (!account?.active || !account.permissions.includes(p)) {
    return;
  }

  setPage(p);
  setMessage('');
  setSelected(null);
}

 function login(username: string, password: string) {
  const user = accounts.find(a =>
    a.username === username.trim() &&
    a.password === password &&
    a.active
  );

  if (!user) return false;

  setCurrentUser({
    username: user.username,
    role: user.role,
  });

  setPage('dashboard');

  return true;
}

 function logout(){
  setCurrentUser(null);
  setPage('dashboard');
  setSelected(null)
}

 function updateLine(id:string,change:Partial<Line>){setLines(current=>current.map(l=>l.id===id?{...l,...change}:l))}
 function addLine(){setLines(current=>[...current,makeLine(products[0])])}
 async function extract(){if(!document){setMessage('Upload a delivery order image first.');return}setBusy(true);setMessage('');try{const image_b64=await fileToBase64(document);const result=await api<{name:string;quantity:number;unit:string}[]>('/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image_b64})});const matched=result.map(item=>{const p=products.find(p=>p.name.toLowerCase()===item.name.toLowerCase()||p.name.toLowerCase().includes(item.name.toLowerCase()))||products[0];return {...makeLine(p),name:item.name,quantity:item.quantity,unit:item.unit}});setLines(matched.length?matched:[makeLine(products[0])]);setDemoMode(false);setStep(2);setMessage('AI extraction completed. Please verify all details.')}catch{setMessage('Extraction API unavailable. You can continue with editable demo data.');setDemoMode(true);setLines([makeLine(products[0]),makeLine(products[4])]);setStep(2)}finally{setBusy(false)}}

 
 async function validate(){if(!lines.length){setMessage('Add at least one item.');return}setBusy(true);setMessage('');const payload={lines:lines.map(l=>({product_id:l.product_id,quantity:Number(l.quantity),unit:l.unit,temp_c:l.temp_c===''?null:Number(l.temp_c),expected_base_qty:l.expected_base_qty===null?null:Number(l.expected_base_qty)}))};let issues:string[]=[];let fallback=false;try{const result=await api<ApiCheck>('/api/deliveries/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});issues=result.checks.flatMap(c=>c.issues.map(i=>`${products.find(p=>p.id===c.product_id)?.name||c.product_id}: ${i}`))}catch{fallback=true;for(const l of lines){const p=products.find(p=>p.id===l.product_id);if(!p){issues.push(`${l.name}: unknown product`);continue}const factor=l.unit===p.base_unit?1:p.pack_units?.find(x=>x.unit===l.unit)?.base_qty;if(!factor)issues.push(`${l.name}: unknown unit ${l.unit}`);else if(l.expected_base_qty!==null&&l.quantity*factor!==Number(l.expected_base_qty))issues.push(`${l.name}: quantity mismatch`);if(p.temp_min_c!==null&&p.temp_max_c!==null){if(l.temp_c==='')issues.push(`${l.name}: temperature missing`);else if(Number(l.temp_c)<p.temp_min_c||Number(l.temp_c)>p.temp_max_c)issues.push(`${l.name}: temperature outside allowed range`)}}}
 for(const l of lines)if(l.condition==='Abnormal')issues.push(`${l.name}: marked abnormal${l.remarks?` — ${l.remarks}`:''}`);

 const documentData = document
  ? await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Unable to read document'));

      reader.readAsDataURL(document);
    })
  : '';


  // ========================================
  // Create Delivery Record
  // ========================================

  const delivery: Delivery = {
    id: `RC-2026-${String(records.length + 1).padStart(3, '0')}`,

    supplier,
    po,
    invoice,

    createdAt: new Date().toLocaleString('en-MY'),

    status: issues.length ? 'Pending Approval' : 'Passed',

    // Delivery Order Photo
    documentName: document?.name || '',
    documentData,

    // Inspection Details & Evidence Photos
    lines: structuredClone(lines),

    issues,
  };

  // Save delivery record
  setRecords(r => [delivery, ...r]);

  // Save result for confirmation screen
  setLastResult(delivery);

  setDemoMode(fallback || demoMode);
  setStep(5);
  setBusy(false);
}


// ========================================
// Manager Approval Decision
// ========================================

function decide(
  d: Delivery,
  status: 'Accepted' | 'Rejected' | 'Returned'
) {
  const next: Delivery = {
    ...d,
    status,
    decision: `${status} by demo manager`,
  };

  setRecords(r =>
    r.map(item =>
      item.id === d.id ? next : item
    )
  );

  setSelected(next);
}


// ========================================
// Reset Receiving Check
// ========================================

function resetReceiving() {
  setStep(0);
  setDocument(null);
  setLines([]);
  setLastResult(null);
  setMessage('');
  setDemoMode(false);

  navigate('receiving');
}


// ========================================
// Login Page
// ========================================

if (!currentUser) {
  return <LoginPage onLogin={login} />;
}

 return <div className="app-shell">

    <Sidebar
      role={role}
      username={currentUser.username}
      page={page}
      pending={pending}
      navItems={navItems.filter(item => {
        if (role === 'admin') return true;

        const account = accounts.find(
          a => a.username === currentUser?.username
        );

        return account?.active &&
          account.permissions.includes(item.key);
      })}
      collapsed={sidebarCollapsed}
      onNavigate={navigate}
      onCollapse={() => setSidebarCollapsed((prev) => !prev)}
      onLogout={logout}
      mobileOpen={mobileOpen}
      onCloseMobile={() => setMobileOpen(false)}
    />

    {mobileOpen && (
      <div
        className="mobile-sidebar-overlay"
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />
    )}

  <main className="main-content">
    <div className="topbar">
      <div className="topbar-left">
        {/* Mobile Navigation Button */}
        <button
          type="button"
          className="mobile-menu-button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
        >
          ☰
        </button>

        {/* Breadcrumb */}
        <span className="breadcrumb">
          SOPBox <span> / </span>
          {navItems.find(n => n.key === page)?.label}
        </span>
      </div>
    </div>
    <div className="page-content">
      {page==='dashboard'&&<>{pending>0&&<div className="priority-alert"><div><strong>⚠ {pending} delivery{pending===1?'':'ies'} waiting for manager approval</strong><p>{role==='admin'?'Review flagged deliveries and make a decision.':'Your flagged deliveries are awaiting manager review.'}</p></div>{role==='admin'&&<button className="outline-btn" onClick={()=>navigate('approvals')}>Review now →</button>}</div>}<div className="page-heading"><div><h1>Dashboard</h1><p>Welcome back! Here's what needs your attention today.</p></div><button className="primary-btn" onClick={resetReceiving}>＋ New Receiving Check</button></div><div className="stat-grid"><Stat label="Total deliveries" value={records.length} icon="▤"/><Stat label="Pending approval" value={pending} icon="◷" accent="amber"/><Stat label="Passed checks" value={records.filter(r=>r.status==='Passed').length} icon="✓" accent="green"/><Stat label="Flagged deliveries" value={failed} icon="!" accent="red"/></div><section className="panel"><div className="panel-head"><div><h2>Recent Deliveries</h2><p>Track receiving checks and their latest status.</p></div><button className="outline-btn" onClick={()=>navigate('records')}>View all →</button></div><DeliveryTable records={records.slice(0,5)} onOpen={setSelected}/></section><section className="panel welcome-panel"><div><h2>Make receiving checks easier</h2><p>Upload a supplier delivery order, verify the extracted items and inspect your shipment in a few steps.</p><button className="primary-btn" onClick={resetReceiving}>Start receiving →</button></div><div className="welcome-icon">▣</div></section></>}
      {page==='receiving'&&<><div className="page-heading"><div><h1>Receiving Check</h1><p>Complete a guided inspection for an incoming supplier delivery.</p></div>{step > 0 && step < 5 && (
      <div className="receiving-start-over">
        <button
          className="outline-btn"
          onClick={resetReceiving}
        >
          Start over
        </button>
      </div>
    )}
</div><div className="stepper">{steps.map((s,i)=><div key={s} className={'step '+(step===i?'current ':'')+(step>i?'done':'')}><span className="step-number">{step>i?'✓':i+1}</span><span>{s}</span></div>)}</div>
        {message&&<div className={'notice '+(demoMode?'warn':'info')}>{message}</div>}
        {step===0&&<section className="panel form-panel"><div className="panel-head"><div><h2>1. Delivery details</h2><p>Identify the supplier and the incoming shipment.</p></div></div><div className="form-grid"><Field label="Supplier *"><input value={supplier} onChange={e=>setSupplier(e.target.value)} placeholder="Supplier name"/></Field><Field label="Purchase Order (PO) No."><input value={po} onChange={e=>setPo(e.target.value)}/></Field><Field label="Invoice No."><input value={invoice} onChange={e=>setInvoice(e.target.value)}/></Field></div><div className="panel-footer"><button className="primary-btn" disabled={!supplier.trim()} onClick={()=>setStep(1)}>Continue →</button></div></section>}
        {step===1&&<section className="panel form-panel"><div className="panel-head"><div><h2>2. Upload Delivery Order</h2><p>Upload a photo or image of the supplier's delivery order.</p></div></div><input ref={inputRef} type="file" accept="image/*" hidden onChange={e=>setDocument(e.target.files?.[0]||null)}/><button className="dropzone" onClick={()=>inputRef.current?.click()}><span className="upload-icon">⇧</span><strong>{document?document.name:'Click to upload a delivery order'}</strong><span>JPG, PNG or another supported image format</span><span className="small-blue">Browse files</span></button><div className="notice info">The existing extraction API accepts image data. PDF document extraction is not implemented in the current backend.</div><div className="panel-footer"><button className="outline-btn" onClick={()=>setStep(0)}>← Back</button><button className="primary-btn" disabled={!document||busy} onClick={extract}>{busy?'Extracting...':'Extract with AI →'}</button></div></section>}
        {step===2&&<section className="panel form-panel"><div className="panel-head"><div><h2>3. Verify extracted data</h2><p>Review the AI output. Correct any product, quantity or unit before continuing.</p></div>
        <div className="receiving-add-item">
          <button
            className="outline-btn"
            onClick={addLine}
          >
            ＋ Add item
          </button>
        </div>
      </div><div className="table-wrap"><table><thead><tr><th>Category</th><th>Product</th><th>DO Quantity</th><th>Unit type</th><th>Units per pack</th><th>Expected base qty</th><th></th></tr></thead><tbody>{lines.map(l=><tr key={l.id}><td>{products.find(p=>p.id===l.product_id)?.category||'Other'}</td><td><select value={l.product_id} onChange={e=>{const p=products.find(p=>p.id===e.target.value)!;updateLine(l.id,{product_id:p.id,name:p.name,unit:p.base_unit})}}>{products.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></td><td><input className="number-input" type="number" min="1" value={l.quantity} onChange={e=>updateLine(l.id,{quantity:Number(e.target.value)})}/></td><td><select value={l.unit} onChange={e=>updateLine(l.id,{unit:e.target.value})}>{[...new Set([l.unit,products.find(p=>p.id===l.product_id)?.base_unit||'pcs',...(products.find(p=>p.id===l.product_id)?.pack_units||[]).map(p=>p.unit)])].map(u=><option key={u}>{u}</option>)}</select></td><td><input className="number-input" type="number" min="1" readOnly aria-label="Units per pack" value={l.unit===products.find(p=>p.id===l.product_id)?.base_unit?1:products.find(p=>p.id===l.product_id)?.pack_units?.find(u=>u.unit===l.unit)?.base_qty??1}/></td><td><input className="number-input" type="number" min="0" placeholder="Optional" value={l.expected_base_qty??''} onChange={e=>updateLine(l.id,{expected_base_qty:e.target.value===''?null:Number(e.target.value)})}/></td><td><button className="text-danger" onClick={()=>setLines(a=>a.filter(x=>x.id!==l.id))}>Remove</button></td></tr>)}</tbody></table></div><div className="panel-footer"><button className="outline-btn" onClick={()=>setStep(1)}>← Back</button><button className="primary-btn" disabled={!lines.length||lines.some(l=>l.quantity<=0)} onClick={()=>setStep(3)}>Confirm & continue →</button></div></section>}
        {step===3&&<section className="panel form-panel"><div className="panel-head"><div><h2>4. Inspect received items</h2><p>Enter the measured temperature and flag any visible issues.</p></div></div><div className="inspection-list">{lines.map((l,i)=>{const p=products.find(p=>p.id===l.product_id);return <div className="inspection-card" key={l.id}><div className="inspection-title"><span className="item-number">{i+1}</span><div><strong>{p?.name||l.name}</strong><small>Expected from DO: {l.quantity} {l.unit} {p?.temp_min_c!==null&&p?.temp_min_c!==undefined?` · Temperature: ${p.temp_min_c}°C to ${p.temp_max_c}°C`:''}</small></div></div><div className="form-grid inspection-fields">
          
      <Field label="Measured temperature (°C)">
          <div className="temperature-control">

            {/* Minus Button */}
            <button
              type="button"
              className="temperature-btn"
              aria-label="Decrease temperature"
              onClick={() => {
                const current = Number(l.temp_c) || 0;

                updateLine(l.id, {
                  temp_c: String(current - 1),
                });
              }}
            >
              −
            </button>

            {/* Temperature Input */}
            <input
              type="number"
              className="temperature-input"
              step="any"
              value={l.temp_c}
              placeholder="e.g. -15"
              onChange={(e) => {
                updateLine(l.id, {
                  temp_c: e.target.value,
                });
              }}
            />

            {/* Plus Button */}
            <button
              type="button"
              className="temperature-btn"
              aria-label="Increase temperature"
              onClick={() => {
                const current = Number(l.temp_c) || 0;

                updateLine(l.id, {
                  temp_c: String(current + 1),
                });
              }}
            >
              +
            </button>

          </div>
      </Field>

<Field label="Visual inspection"><select value={l.condition} onChange={e=>updateLine(l.id,{condition:e.target.value as Line['condition']})}><option>Normal</option><option>Abnormal</option></select></Field>
<Field label="Evidence photo (optional)">
  <input
    type="file"
    accept="image/*"
    onChange={async (e) => {
      const file = e.target.files?.[0];

      if (!file) {
        updateLine(l.id, {
          photoName: '',
          photoData: ''
        });
        return;
      }

      const reader = new FileReader();

      reader.onload = () => {
        updateLine(l.id, {
          photoName: file.name,
          photoData: String(reader.result)
        });
      };

      reader.readAsDataURL(file);
    }}
  />

  {l.photoData && (
    <img
      src={l.photoData}
      alt={`Evidence for ${l.name}`}
      className="evidence-preview"
    />
  )}
</Field>
</div>{l.condition==='Abnormal'&&<Field label="Issue remarks"><textarea value={l.remarks} onChange={e=>updateLine(l.id,{remarks:e.target.value})} placeholder="Describe the damaged packaging or other issue"/></Field>}</div>})}</div><div className="panel-footer"><button className="outline-btn" onClick={()=>setStep(2)}>← Back</button><button className="primary-btn" onClick={()=>setStep(4)}>Review inspection →</button></div></section>}
        {step===4&&<section className="panel form-panel"><div className="panel-head"><div><h2>5. Review & submit</h2><p>Confirm the details before running validation.</p></div></div><div className="summary-grid"><div><small>Supplier</small><strong>{supplier}</strong></div><div><small>Purchase order</small><strong>{po||'—'}</strong></div><div><small>Invoice</small><strong>{invoice||'—'}</strong></div><div><small>Items</small><strong>{lines.length}</strong></div></div><div className="table-wrap"><table><thead><tr><th>Item</th><th>Quantity</th><th>Temperature</th><th>Condition</th></tr></thead><tbody>{lines.map(l=><tr key={l.id}><td>{l.name}</td><td>{l.quantity} {l.unit}</td><td>{l.temp_c===''?'Not entered':`${l.temp_c}°C`}</td><td>{badge(l.condition)}</td></tr>)}</tbody></table></div>

{/* Uploaded Photos Preview */}
<div className="evidence-section">

  <h3>Uploaded Delivery Order</h3>

  {document ? (
    <div className="evidence-item">
      <img
        src={documentPreview}
        alt="Delivery Order"
        className="evidence-preview"
      />
      <p>{document.name}</p>
    </div>
  ) : (
    <p>No delivery order uploaded.</p>
  )}

  <h3>Inspection Evidence Photos</h3>

  <div className="evidence-gallery">
    {lines.filter(l => l.photoData).map(l => (
      <div key={l.id} className="evidence-item">
        <img
          src={l.photoData}
          alt={`Evidence for ${l.name}`}
          className="evidence-preview"
        />
        <strong>{l.name}</strong>
        <small>{l.photoName}</small>
      </div>
    ))}
  </div>

  {!lines.some(l => l.photoData) && (
    <p>No inspection evidence uploaded.</p>
  )}

</div>

<div className="panel-footer">
  <button className="outline-btn" onClick={()=>setStep(3)}>← Back</button><button className="primary-btn" disabled={busy} onClick={validate}>{busy?'Submitting...':'Submit ✓'}</button></div></section>}
        {step===5&&lastResult&&<section className="panel result-panel"><div className={'result-mark '+(lastResult.status==='Passed'?'success':'warning')}>{lastResult.status==='Passed'?'✓':'!'}</div><h2>{lastResult.status==='Passed'?'Receiving check passed':'Manager approval required'}</h2><p>Reference {lastResult.id} · {supplier}</p>{badge(lastResult.status)}{lastResult.issues.length>0&&<div className="issue-box"><strong>Validation issues</strong>{lastResult.issues.map((issue,i)=><div key={i}>• {issue}</div>)}</div>}<div className="notice warn">Demo only: the result is stored in browser memory. Approval persistence and audit logging require backend endpoints.</div><div className="result-actions"><button className="outline-btn" onClick={()=>navigate('records')}>View delivery records</button><button className="primary-btn" onClick={resetReceiving}>＋ New receiving check</button></div></section>}
      </>}
      {page==='records'&&<><div className="page-heading"><div><h1>Delivery Records</h1><p>View receiving history and inspection outcomes.</p></div><button className="primary-btn" onClick={resetReceiving}>＋ Create</button></div><section className="panel"><div className="filter-bar"><label className="search-input">⌕ <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search delivery ID, supplier, status..."/></label><span>{filtered.length} records</span></div><DeliveryTable records={filtered} onOpen={setSelected}/></section></>}
      {page==='products'&&<><div className="page-heading"><div><h1>Products & SOP</h1><p>Reference catalogue and receiving temperature rules.</p></div>{badge('Read-only demo')}</div><section className="panel"><div className="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Base unit</th><th>Temperature range</th><th>Pack conversion</th></tr></thead><tbody>{products.map(p=><tr key={p.id}><td><strong>{p.name}</strong></td><td>{p.category}</td><td>{p.base_unit}</td><td>{p.temp_min_c===null?'Not configured':`${p.temp_min_c}°C to ${p.temp_max_c}°C`}</td><td>{p.pack_units?.map(u=>`1 ${u.unit} = ${u.base_qty} ${p.base_unit}`).join(', ')||'—'}</td></tr>)}</tbody></table></div><div className="notice info">Product and SOP editing requires additional backend CRUD endpoints. SOP content is not yet provided by the current API.</div></section></>}
      {page==='approvals'&&role==='admin'&&<><div className="page-heading"><div><h1>Approval Requests</h1><p>Review deliveries that need a manager decision.</p></div>{badge(`${pending} pending`)}</div><section className="panel"><DeliveryTable records={records.filter(r=>r.status==='Pending Approval')} onOpen={setSelected}/></section></>}

{/* ========================================
    User Management - Admin Only
======================================== */}
      
      {page === 'users' && role === 'admin' && (
        <UserManagement
          accounts={accounts}
          onCreate={handleCreateStaff}
          onUpdate={handleUpdateStaff}
          onRemove={handleRemoveStaff}
        />
      )}

{/* ========================================
    Activity Logs - Admin Only
======================================== */}

      {page==='activity'&&role==='admin'&&<>
      <div className="page-heading"><div>
        <h1>Activity Logs</h1>
        <p>Preview of receiving activity (browser demo only).</p>
        </div>
        </div>
        <section className="panel">
          <div className="timeline">{records.map(r=>
            <div className="timeline-item" key={r.id}>
              <span className="timeline-dot"/>
          <div>
            <strong>{r.id} — {r.status}</strong>
            <p>{r.supplier} · {r.createdAt}</p>{r.decision&&<p>{r.decision}</p>}
            </div>
            </div>)}
            </div>
            </section>
            </>}
    </div>

  </main>
  
    {selected && (
      <div
        className="modal-backdrop"
        onClick={() => setSelected(null)}
      >
        <div
          className="modal"
          onClick={(e) => e.stopPropagation()}
        >

          {/* ========================================
              Modal Header
          ======================================== */}

          <div className="modal-title">
            <h2>Delivery details</h2>

            <button
              className="icon-button"
              onClick={() => setSelected(null)}
            >
              ✕
            </button>
          </div>


          {/* ========================================
              Modal Body
          ======================================== */}

          <div className="modal-body">

            {/* Delivery Information */}

            <div className="summary-grid">
              <div>
                <small>Reference</small>
                <strong>{selected.id}</strong>
              </div>

              <div>
                <small>Supplier</small>
                <strong>{selected.supplier}</strong>
              </div>

              <div>
                <small>PO No.</small>
                <strong>{selected.po}</strong>
              </div>

              <div>
                <small>Status</small>
                {badge(selected.status)}
              </div>
            </div>


            {/* ========================================
                Validation Summary
            ======================================== */}

            <h3>Validation summary</h3>

            {selected.issues.length > 0 ? (
              selected.issues.map((issue, i) => (
                <p className="issue-line" key={i}>
                  ⚠ {issue}
                </p>
              ))
            ) : (
              <p>No issues recorded.</p>
            )}


            {/* ========================================
                Uploaded Delivery Order
            ======================================== */}

            <h3>Uploaded Delivery Order</h3>

            {selected.documentData ? (
              <div className="evidence-item">
                {selected.documentData.startsWith('data:image/') ? (
                  <img
                    src={selected.documentData}
                    alt="Uploaded Delivery Order"
                    className="evidence-preview"
                  />
                ) : (
                  <a
                    href={selected.documentData}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View uploaded document
                  </a>
                )}

                <p>{selected.documentName}</p>
              </div>
            ) : (
              <p>No delivery order uploaded.</p>
            )}


            {/* ========================================
                Inspection Evidence Photos
            ======================================== */}

            <h3>Inspection Evidence Photos</h3>

            <div className="evidence-gallery">
              {selected.lines
                .filter((line) => line.photoData)
                .map((line) => (
                  <div
                    className="evidence-item"
                    key={line.id}
                  >
                    <img
                      src={line.photoData}
                      alt={`Evidence for ${line.name}`}
                      className="evidence-preview"
                    />

                    <strong>{line.name}</strong>

                    <small>{line.photoName}</small>
                  </div>
                ))}
            </div>

            {!selected.lines.some((line) => line.photoData) && (
              <p>No inspection evidence uploaded.</p>
            )}


            {/* ========================================
                Delivery Timeline
            ======================================== */}

            <h3>Delivery timeline</h3>

            <div className="timeline">

              <div className="timeline-item">
                <span className="timeline-dot" />

                <div>
                  <strong>Receiving submitted</strong>
                  <p>{selected.createdAt}</p>
                </div>
              </div>

              <div className="timeline-item">
                <span className="timeline-dot" />

                <div>
                  <strong>{selected.status}</strong>

                  <p>
                    {selected.decision || 'Latest validation status'}
                  </p>
                </div>
              </div>

            </div>


            {/* Demo Approval Notice */}

            {selected.status === 'Pending Approval' &&
              role === 'admin' && (
                <div className="notice warn">
                  Demo approval: changes are not saved to
                  the backend or audit database.
                </div>
              )}

          </div>


          {/* ========================================
              Modal Footer
          ======================================== */}

          <div className="modal-actions">

            <button
              className="outline-btn"
              onClick={() => setSelected(null)}
            >
              Close
            </button>

            {selected.status === 'Pending Approval' &&
              role === 'admin' && (
                <>
                  <button
                    className="danger-btn"
                    onClick={() => decide(selected, 'Rejected')}
                  >
                    Reject
                  </button>

                  <button
                    className="outline-btn"
                    onClick={() => decide(selected, 'Returned')}
                  >
                    Return
                  </button>

                  <button
                    className="primary-btn"
                    onClick={() => decide(selected, 'Accepted')}
                  >
                    Accept delivery
                  </button>
                </>
              )}

          </div>

        </div>
      </div>
    )}

 </div>
}
