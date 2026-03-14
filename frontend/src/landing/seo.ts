export interface SeoMeta {
  title: string;
  description: string;
  canonicalUrl: string;
  robots?: string;
}

const upsertMetaByName = (name: string, content: string): void => {
  let element = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute('name', name);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
};

const upsertMetaByProperty = (property: string, content: string): void => {
  let element = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null;
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute('property', property);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
};

const upsertCanonical = (href: string): void => {
  let element = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', 'canonical');
    document.head.appendChild(element);
  }
  element.setAttribute('href', href);
};

export const applySeoMeta = (meta: SeoMeta): void => {
  if (typeof document === 'undefined') return;
  document.title = meta.title;
  upsertMetaByName('description', meta.description);
  upsertMetaByName('robots', meta.robots || 'index,follow');
  upsertCanonical(meta.canonicalUrl);

  upsertMetaByProperty('og:type', 'website');
  upsertMetaByProperty('og:title', meta.title);
  upsertMetaByProperty('og:description', meta.description);
  upsertMetaByProperty('og:url', meta.canonicalUrl);

  upsertMetaByName('twitter:card', 'summary_large_image');
  upsertMetaByName('twitter:title', meta.title);
  upsertMetaByName('twitter:description', meta.description);
};
