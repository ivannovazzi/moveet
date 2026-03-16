import type { HTMLAttributes, ReactNode } from "react";
import classNames from "classnames";
import styles from "./PanelPrimitives.module.css";

interface PanelShellProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export function PanelShell({ children, className, ...props }: PanelShellProps) {
  return (
    <section {...props} className={classNames(styles.panelShell, className)}>
      {children}
    </section>
  );
}

interface PanelHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  children?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  titleAs?: "h2" | "h3";
}

export function PanelHeader({
  eyebrow,
  title,
  subtitle,
  badge,
  actions,
  children,
  titleAs = "h2",
  className,
  ...props
}: PanelHeaderProps) {
  const TitleTag = titleAs;

  return (
    <div {...props} className={classNames(styles.panelHeader, className)}>
      <div className={styles.headerRow}>
        <div className={styles.headerCopy}>
          {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
          <div className={styles.headingRow}>
            <TitleTag className={styles.panelTitle}>{title}</TitleTag>
            {badge ? <div className={styles.headerMeta}>{badge}</div> : null}
          </div>
          {subtitle ? <p className={styles.panelSubtitle}>{subtitle}</p> : null}
        </div>
        {actions ? <div className={styles.headerActions}>{actions}</div> : null}
      </div>
      {children ? <div className={styles.headerContent}>{children}</div> : null}
    </div>
  );
}

interface PanelBodyProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padded?: boolean;
  scrollable?: boolean;
}

export function PanelBody({
  children,
  padded = true,
  scrollable = true,
  className,
  ...props
}: PanelBodyProps) {
  return (
    <div
      {...props}
      className={classNames(
        styles.panelBody,
        {
          [styles.panelBodyPadded]: padded,
          [styles.panelBodyScrollable]: scrollable,
        },
        className
      )}
    >
      {children}
    </div>
  );
}

interface PanelBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: "neutral" | "active" | "healthy" | "warning";
}

export function PanelBadge({ children, tone = "active", className, ...props }: PanelBadgeProps) {
  return (
    <span {...props} className={classNames(styles.panelBadge, className)} data-tone={tone}>
      {children}
    </span>
  );
}

interface PanelEmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function PanelEmptyState({ children, className, ...props }: PanelEmptyStateProps) {
  return (
    <div {...props} className={classNames(styles.emptyState, className)}>
      {children}
    </div>
  );
}

interface PanelSectionLabelProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export function PanelSectionLabel({ children, className, ...props }: PanelSectionLabelProps) {
  return (
    <span {...props} className={classNames(styles.sectionLabel, className)}>
      {children}
    </span>
  );
}
