import styles from "./integration-marquee.module.css";

const integrations = [
  { name: "HubSpot", kind: "hubspot" },
  { name: "GoHighLevel", kind: "highlevel" },
  { name: "monday.com", kind: "monday" },
  { name: "Gmail", kind: "gmail" },
  { name: "Microsoft Outlook", kind: "outlook" },
  { name: "Custom APIs", kind: "api" },
  { name: "Webhooks", kind: "webhooks" },
] as const;

type Integration = (typeof integrations)[number];

function IntegrationIcon({ kind }: Pick<Integration, "kind">) {
  if (kind === "hubspot") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M18.164 7.93V5.084a2.198 2.198 0 0 0 1.267-1.978v-.067A2.2 2.2 0 0 0 17.238.845h-.067a2.2 2.2 0 0 0-2.193 2.193v.067a2.196 2.196 0 0 0 1.252 1.973l.013.006v2.852a6.22 6.22 0 0 0-2.969 1.31l.012-.01-7.828-6.095A2.497 2.497 0 1 0 4.3 4.656l-.012.006 7.697 5.991a6.176 6.176 0 0 0-1.038 3.446c0 1.343.425 2.588 1.147 3.607l-.013-.02-2.342 2.343a1.968 1.968 0 0 0-.58-.095h-.002a2.033 2.033 0 1 0 2.033 2.033 1.978 1.978 0 0 0-.1-.595l.005.014 2.317-2.317a6.247 6.247 0 1 0 4.782-11.134l-.036-.005Zm-.964 9.378a3.206 3.206 0 1 1 3.215-3.207v.002a3.206 3.206 0 0 1-3.207 3.207Z" />
      </svg>
    );
  }

  if (kind === "highlevel") {
    return (
      <svg aria-hidden="true" viewBox="0 0 46 34">
        <path fill="#FFD000" d="M0 10 8 2l8 8h-5v22H5V10H0Z" />
        <path fill="#2896FB" d="m15 17 8-8 8 8h-5v15h-6V17h-5Z" />
        <path fill="#17D94B" d="m30 10 8-8 8 8h-5v22h-6V10h-5Z" />
      </svg>
    );
  }

  if (kind === "monday") {
    return (
      <svg aria-hidden="true" viewBox="0 0 256 156">
        <path fill="#F62B54" d="M31.846 153.489a31.97 31.97 0 0 1-27.86-16.167 30.91 30.91 0 0 1 .875-31.823l57.373-90.096A31.99 31.99 0 0 1 90.556.015a31.93 31.93 0 0 1 27.41 16.896c5.349 10.113 4.68 22.28-1.725 31.774L58.904 138.78a31.98 31.98 0 0 1-27.058 14.709" />
        <path fill="#FFCC00" d="M130.256 153.488c-11.572 0-22.22-6.187-27.812-16.13a30.81 30.81 0 0 1 .875-31.737l57.264-89.89A31.94 31.94 0 0 1 188.93.016c11.669.255 22.244 6.782 27.592 16.993a30.81 30.81 0 0 1-2.066 31.92l-57.252 89.889a31.93 31.93 0 0 1-26.948 14.671" />
        <ellipse cx="226.466" cy="125.324" fill="#00CA72" rx="29.538" ry="28.918" />
      </svg>
    );
  }

  if (kind === "gmail") {
    return (
      <svg aria-hidden="true" viewBox="0 0 256 193">
        <path fill="#4285F4" d="M58.182 192.05V93.14L27.507 65.077 0 49.504v125.091c0 9.658 7.825 17.455 17.455 17.455z" />
        <path fill="#34A853" d="M197.818 192.05h40.727c9.659 0 17.455-7.826 17.455-17.455V49.505l-31.156 17.837-27.026 25.798z" />
        <path fill="#EA4335" d="m58.182 93.14-4.174-38.647 4.174-36.989L128 69.868l69.818-52.364 4.669 34.992-4.669 40.644L128 145.504z" />
        <path fill="#FBBC04" d="M197.818 17.504V93.14L256 49.504V26.231c0-21.585-24.64-33.89-41.89-20.945z" />
        <path fill="#C5221F" d="m0 49.504 26.759 20.07L58.182 93.14V17.504L41.89 5.286C24.61-7.66 0 4.646 0 26.23z" />
      </svg>
    );
  }

  if (kind === "outlook") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M8.56 12.03q0 .38-.06.73-.11.34-.3.62-.2.27-.49.43-.3.16-.71.16-.42 0-.71-.17t-.48-.45-.27-.63q-.09-.35-.09-.72 0-.36.09-.72.08-.35.27-.63t.5-.45q.3-.17.72-.17.43 0 .72.17.3.18.48.46.18.29.27.64.06.36.06.73M22 12v7.81q0 .39-.27.69-.28.25-.67.25H7.94q-.39 0-.67-.25Q7 20.2 7 19.81V17H2.83q-.33 0-.59-.24Q2 16.5 2 16.17V7.83q0-.33.24-.59Q2.5 7 2.83 7h5.42V4.13q0-.37.25-.63.26-.25.63-.25h10.74q.37 0 .63.25.25.26.25.63v6.91l1.04.6h.01q.08.06.14.16.06.09.06.2m-5-6.87v2.5h2.5v-2.5M17 8.88v2.5h2.5v-2.5M17 12.63v1.52l2.54-1.52m-6.91-7.5v2.5h3.12v-2.5m-3.12 3.75v2.5h3.12v-2.5m-3.12 3.75v1.69l2.01 1.24 1.11-.66v-2.27M9.5 5.13V7h1.77q.06 0 .11.04V5.12M7 15.32q.73 0 1.32-.26.58-.26.99-.71.4-.45.6-1.07.21-.62.22-1.34 0-.69-.21-1.29-.2-.59-.6-1.03-.39-.44-.95-.69-.57-.25-1.29-.25-.77 0-1.37.25-.59.25-1 .7-.41.46-.62 1.08-.21.63-.21 1.37 0 .7.21 1.3.22.59.62 1.02t.97.68q.58.24 1.32.24m1.25 4.18h10.32L12 15.4v.77q0 .33-.24.59-.26.24-.59.24H8.25m12.5 2.39v-6.03l-4.92 2.95Z" />
      </svg>
    );
  }

  if (kind === "api") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="m8.2 5.7-6 6.3 6 6.3 1.8-1.7L5.7 12 10 7.4 8.2 5.7Zm7.6 0L14 7.4l4.3 4.6-4.3 4.6 1.8 1.7 6-6.3-6-6.3Z" />
      </svg>
    );
  }

  if (kind === "webhooks") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M6.25 3a3.25 3.25 0 1 0 2.87 4.77l2.04 1.35a3.2 3.2 0 0 0 0 1.76l-2.04 1.35a3.25 3.25 0 1 0 1.11 1.66l2.05-1.36a3.25 3.25 0 1 0 0-5.06l-2.05-1.36A3.25 3.25 0 0 0 6.25 3Zm0 2a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Zm9 3.75A1.25 1.25 0 1 1 15.25 11.25a1.25 1.25 0 0 1 0-2.5Zm-9 3.75a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Z" />
      </svg>
    );
  }

  return null;
}

function IntegrationList({ duplicate = false }: { duplicate?: boolean }) {
  return (
    <ul
      aria-hidden={duplicate ? "true" : undefined}
      aria-label={duplicate ? undefined : "Platforms and connection methods Ajani works with"}
      className={styles.group}
    >
      {integrations.map((integration) => (
        <li className={styles[integration.kind]} key={integration.name}>
          <IntegrationIcon kind={integration.kind} />
          <span>{integration.name}</span>
        </li>
      ))}
    </ul>
  );
}

export function IntegrationMarquee() {
  return (
    <section aria-labelledby="integration-marquee-title" className={styles.section}>
      <div className={styles.inner}>
        <header className={styles.intro}>
          <p>CRM · work management · email</p>
          <h2 id="integration-marquee-title">Ajani integrates with</h2>
        </header>

        <div className={styles.viewport}>
          <div className={styles.track}>
            <IntegrationList />
            <IntegrationList duplicate />
            <IntegrationList duplicate />
          </div>
        </div>

      </div>
    </section>
  );
}
