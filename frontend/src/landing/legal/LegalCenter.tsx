import React from 'react';
import { BrandLogo } from '../../../components/BrandLogo';
import { LegalLinks } from '../LegalLinks';
import { getLegalDocuments, type LegalDocument } from './legalContent';

interface LegalCenterProps {
  activeDocument: LegalDocument | null;
}

const legalDocs = getLegalDocuments();

export const LegalCenter: React.FC<LegalCenterProps> = ({ activeDocument }) => {
  return (
    <div className="min-h-screen bg-[linear-gradient(170deg,#f8fcff_0%,#f4f7ff_48%,#eef7ff_100%)] text-gray-900">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="rounded-3xl border border-white/70 bg-white/80 p-6 shadow-xl shadow-sky-100/60 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <BrandLogo size="sm" tone="dark" showWordmark={false} />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                  V FLOW AI
                </p>
                <h1 className="text-xl font-extrabold sm:text-2xl">
                  {activeDocument ? activeDocument.title : 'Legal Center'}
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <a
                href="/"
                className="rounded-full border border-sky-200 bg-white px-4 py-2 text-xs font-semibold text-sky-700 transition hover:bg-sky-50"
              >
                Home
              </a>
              <a
                href="https://v-flow-ai.com/app"
                className="rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-cyan-200 transition hover:brightness-105"
              >
                Open App
              </a>
            </div>
          </div>
          <div className="mt-4 border-t border-gray-100 pt-4">
            <LegalLinks {...(activeDocument ? { activePath: activeDocument.path } : {})} />
          </div>
        </header>

        {!activeDocument && (
          <section className="mt-6 rounded-3xl border border-white/70 bg-white/85 p-6 shadow-lg shadow-sky-100/60 sm:p-8">
            <h2 className="text-lg font-bold">All policy pages</h2>
            <p className="mt-2 text-sm text-gray-600">
              Use the links below to review policy documents, billing terms, and usage rules for V FLOW AI.
            </p>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {legalDocs.map((document) => (
                <li key={document.path}>
                  <a
                    href={document.path}
                    className="block rounded-2xl border border-sky-100 bg-sky-50/60 p-4 transition hover:border-sky-300 hover:bg-sky-50"
                  >
                    <p className="text-sm font-bold text-gray-900">{document.title}</p>
                    <p className="mt-1 text-xs text-gray-600">{document.description}</p>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {activeDocument && (
          <article className="mt-6 rounded-3xl border border-white/70 bg-white/85 p-6 shadow-lg shadow-sky-100/60 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
              Last updated {activeDocument.lastUpdated}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-gray-600">{activeDocument.description}</p>
            <div className="mt-6 space-y-6">
              {activeDocument.sections.map((section) => (
                <section key={section.heading}>
                  <h2 className="text-base font-bold text-gray-900 sm:text-lg">{section.heading}</h2>
                  <div className="mt-2 space-y-2 text-sm leading-relaxed text-gray-700">
                    {section.paragraphs.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <div className="mt-8 rounded-2xl border border-sky-100 bg-sky-50 p-4 text-xs leading-relaxed text-sky-800">
              Questions about these policies can be sent to legal@v-flow-ai.com.
            </div>
          </article>
        )}
      </div>
    </div>
  );
};
