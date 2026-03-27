import { Text } from '@mantine/core'
import { IconArrowsExchange, IconShieldLock, IconUserCircle } from '@tabler/icons-react'
import { NavLink } from 'react-router'
import styles from './BottomTabBar.module.css'

const tabs = [
  { href: '/vault', icon: IconShieldLock, label: 'Vault' },
  { href: '/transfer', icon: IconArrowsExchange, label: 'Transfer' },
  { href: '/profile', icon: IconUserCircle, label: 'Profile' },
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