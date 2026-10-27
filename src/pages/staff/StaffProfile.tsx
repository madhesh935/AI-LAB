import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User,
  Mail,
  Phone,
  Building2,
  Calendar,
  Clock,
  ShieldCheck,
  LogOut,
  Smartphone,
  Download,
  CheckCircle2,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { useStaffAuth } from '../../context/StaffAuthContext';

export const StaffProfile: React.FC = () => {
  const navigate = useNavigate();
  const { currentStaff, logout, quickSwitchUser, availableStaffList, storeName } = useStaffAuth();
  const [showInstallHelp, setShowInstallHelp] = useState<boolean>(false);
  const [isSwitchOpen, setIsSwitchOpen] = useState<boolean>(false);

  const handleLogout = () => {
    if (confirm('Are you sure you want to sign out of RetailEdge Staff?')) {
      logout();
      navigate('/staff/login');
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* 1. Profile Header Card */}
      <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm text-center space-y-3 relative overflow-hidden">
        <div className="relative inline-block mx-auto">
          <img
            src={
              currentStaff?.avatar ||
              'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=160&h=160&fit=crop&crop=face'
            }
            alt={currentStaff?.name}
            className="w-20 h-20 rounded-full object-cover border-4 border-slate-100 shadow-md mx-auto"
          />
          <span
            className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-emerald-500 border-2 border-white"
            title="Active Store Associate"
          />
        </div>

        <div>
          <h1 className="text-lg font-black text-slate-900 tracking-tight">
            {currentStaff?.name || 'Retail Associate'}
          </h1>
          <p className="text-xs font-bold text-blue-600 mt-0.5">{currentStaff?.roleLabel}</p>
          <div className="flex items-center justify-center gap-1.5 mt-1 text-slate-500 text-xs">
            <span className="font-mono font-semibold bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-[11px]">
              ID: {currentStaff?.id}
            </span>
            <span>•</span>
            <span>{currentStaff?.department}</span>
          </div>
        </div>

        {/* Quick Switch Button (for Judges & Demo evaluators) */}
        <div className="pt-2">
          <button
            onClick={() => setIsSwitchOpen(!isSwitchOpen)}
            className="text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl transition-colors inline-flex items-center gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            <span>Switch Evaluator Profile</span>
          </button>

          {isSwitchOpen && (
            <div className="mt-3 p-2 bg-slate-50 border border-slate-200 rounded-2xl space-y-1 text-left">
              <span className="text-[11px] uppercase font-bold text-slate-400 block px-2 py-1">
                Select Seeded Staff Member:
              </span>
              {availableStaffList.slice(0, 5).map((staff) => (
                <button
                  key={staff.id}
                  onClick={() => {
                    quickSwitchUser(staff.id);
                    setIsSwitchOpen(false);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-xl text-xs flex items-center justify-between ${
                    staff.id === currentStaff?.id
                      ? 'bg-blue-600 text-white font-bold'
                      : 'text-slate-700 hover:bg-white'
                  }`}
                >
                  <span>{staff.name} ({staff.roleLabel})</span>
                  <span className="font-mono text-[11px] opacity-75">{staff.id}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 2. Employment & Store Context */}
      <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-2xs space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Store Scope & Credentials
        </h2>

        <div className="space-y-2.5 text-xs">
          <div className="flex items-center justify-between py-1 border-b border-slate-100">
            <span className="text-slate-500 flex items-center gap-1.5">
              <Building2 className="h-4 w-4 text-slate-400" />
              <span>Assigned Store</span>
            </span>
            <span className="font-bold text-slate-800">{storeName || currentStaff?.storeId}</span>
          </div>

          <div className="flex items-center justify-between py-1 border-b border-slate-100">
            <span className="text-slate-500 flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-slate-400" />
              <span>Assigned Shift</span>
            </span>
            <span className="font-mono font-semibold text-slate-800">
              {currentStaff?.currentShiftLabel || 'Morning (08:00 – 16:00)'}
            </span>
          </div>

          <div className="flex items-center justify-between py-1 border-b border-slate-100">
            <span className="text-slate-500 flex items-center gap-1.5">
              <Mail className="h-4 w-4 text-slate-400" />
              <span>Work Email</span>
            </span>
            <span className="font-medium text-blue-600">{currentStaff?.email}</span>
          </div>

          <div className="flex items-center justify-between py-1">
            <span className="text-slate-500 flex items-center gap-1.5">
              <Phone className="h-4 w-4 text-slate-400" />
              <span>Work Phone</span>
            </span>
            <span className="font-mono font-medium text-slate-800">{currentStaff?.phone}</span>
          </div>
        </div>
      </div>

      {/* 3. PWA Installation Information */}
      <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
              <Smartphone className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-900">RetailEdge Staff PWA</h3>
              
            </div>
          </div>
          <button
            onClick={() => setShowInstallHelp(!showInstallHelp)}
            className="text-xs font-bold text-blue-600 hover:text-blue-700"
          >
            {showInstallHelp ? 'Hide' : 'Install Info'}
          </button>
        </div>

        {showInstallHelp && (
          <div className="pt-2 border-t border-slate-100 text-xs text-slate-600 space-y-2 leading-relaxed bg-slate-50 p-3 rounded-2xl">
            <p className="font-bold text-slate-800">To Install on Mobile or Desktop:</p>
            <ul className="list-disc pl-4 space-y-1 text-[11px]">
              <li><strong>Chrome / Android:</strong> Tap the 3 dots menu and select <em>"Install App"</em> or <em>"Add to Home screen"</em>.</li>
              <li><strong>Safari / iOS:</strong> Tap the Share button at bottom and select <em>"Add to Home Screen"</em>.</li>
              <li><strong>Desktop:</strong> Click the install icon in the URL bar to launch standalone.</li>
            </ul>
          </div>
        )}
      </div>

      {/* 4. Logout Button */}
      <div className="pt-2">
        <button
          onClick={handleLogout}
          className="w-full py-3 rounded-2xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs flex items-center justify-center gap-2 transition-colors shadow-2xs"
        >
          <LogOut className="h-4 w-4" />
          <span>Sign Out of Staff App</span>
        </button>
        <p className="text-center text-[11px] text-slate-400 mt-2">
          Signing out clears saved tasks from this device.
        </p>
      </div>
    </div>
  );
};
