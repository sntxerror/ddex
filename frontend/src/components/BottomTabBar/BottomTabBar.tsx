import { Text } from '@mantine/core'
import { IconArrowsExchange, IconSettings2, IconShieldLock } from '@tabler/icons-react'
import { NavLink } from 'react-router'
import styles from './BottomTabBar.module.css'

const tabs = [
  { href: '/wallet', icon: IconShieldLock, label: 'Wallet' },
  { href: '/transfer', icon: IconArrowsExchange, label: 'Transfer' },
  { href: '/settings', icon: IconSettings2, label: 'Settings' },
] as const

export function BottomTabBar() {
  return (
    <nav aria-label="Primary">
      <div className={styles.bar}>
        {tabs.map((tab) => {
          const Icon = tab.icon

          return (
            <NavLink
              key={tab.href}
              className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`.trim()}
              to={tab.href}
            >
              <Icon size={20} stroke={1.9} />
              <Text className={styles.label} component="span">{tab.label}</Text>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}