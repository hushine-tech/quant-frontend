import type { ReactNode } from "react";

export type PageTab<T extends string> = {
  id: T;
  label: string;
};

type PageTabsProps<T extends string> = {
  tabs: Array<PageTab<T>>;
  activeTab: T;
  onChange: (tab: T) => void;
  ariaLabel: string;
  children: ReactNode;
};

export default function PageTabs<T extends string>({
  tabs,
  activeTab,
  onChange,
  ariaLabel,
  children,
}: PageTabsProps<T>) {
  return (
    <div className="primary-tabs">
      <div className="primary-tabs__list" role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`primary-tabs__tab ${activeTab === tab.id ? "primary-tabs__tab--active" : ""}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <section className="primary-tabs__panel">
        {children}
      </section>
    </div>
  );
}
