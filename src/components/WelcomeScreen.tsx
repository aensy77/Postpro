import React from 'react';
import { APP_INFO, PostProLogo } from './PostProLogo';

interface WelcomeScreenProps {
  onStartSetup: () => void;
  onSkipToWorkspace: () => void;
  hasSavedConfig: boolean;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onStartSetup,
  onSkipToWorkspace,
  hasSavedConfig,
}) => {
  return (
    <section className="fixed inset-0 z-50 cad-grid-bg flex items-center justify-center p-4 overflow-y-auto">
      <div className="anim-enter w-full max-w-2xl bg-panel/95 border border-cyberBorder rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.92)] overflow-hidden">
        <div className="h-9 bg-elevated border-b border-cyberBorder px-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 truncate">
            <PostProLogo size={16} className="shrink-0" />
            <span>
              {APP_INFO.fullName} · v{APP_INFO.version} · Por {APP_INFO.creator}
            </span>
          </div>
          <button
            onClick={onSkipToWorkspace}
            className="text-[11px] font-mono text-slate-400 hover:text-cyberCyan cursor-pointer whitespace-nowrap shrink-0"
          >
            Saltar al estudio →
          </button>
        </div>

        <div className="p-8 sm:p-11 flex flex-col items-center text-center relative">
          <div className="mb-6 flex items-center justify-center drop-shadow-[0_0_24px_rgba(0,240,255,0.28)]">
            <PostProLogo size={76} />
          </div>

          <span className="text-cyberCyan font-mono text-[11px] tracking-widest uppercase mb-3">
            ESTUDIO BBCODE · MEDIAINFO · CAPTURAS · METADATOS
          </span>

          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
            Bienvenido a{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyberCyan via-white to-cyberMagenta">
              {APP_INFO.name}
            </span>
          </h1>

          <p className="mt-2 font-mono text-xs text-slate-400 tabular-nums">
            Versión {APP_INFO.version} <span aria-hidden="true">·</span> Creado por{' '}
            <span className="text-slate-200 font-semibold">{APP_INFO.creator}</span>
          </p>

          <p className="mt-3 text-base sm:text-lg text-slate-300 font-medium">
            Empecemos configurando tu espacio de trabajo y proveedores
          </p>

          <p className="mt-2 max-w-md text-xs text-slate-400 leading-relaxed">
            Selecciona tus carpetas locales de medios y plantillas desde tu navegador, configura tus APIs de
            metadatos e imágenes y guarda todo automáticamente.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
            <button
              onClick={onStartSetup}
              className="neon-btn-cyan w-full sm:w-auto px-8 py-3 rounded-xl font-extrabold text-sm tracking-wide cursor-pointer flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <span>{hasSavedConfig ? 'Revisar Configuración' : 'Empezar Configuración'}</span>
              <span>→</span>
            </button>
            <button
              onClick={onSkipToWorkspace}
              className="w-full sm:w-auto px-5 py-3 rounded-xl bg-void hover:bg-elevated border border-cyberBorder text-slate-300 hover:text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              Abrir Estudio Directamente
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
