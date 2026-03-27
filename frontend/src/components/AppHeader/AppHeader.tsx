import {
  ActionIcon,
  Avatar,
  Burger,
  Drawer,
  Group,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
} from '@mantine/core'
import { IconMoonStars, IconSunHigh } from '@tabler/icons-react'
import styles from './AppHeader.module.css'
import type { AppHeaderProps } from './AppHeader.types'

export function AppHeader({
  currentView,
  isDark,
  mobileNavigationOpened,
  navigationItems,
  onCloseMobileNavigation,
  onNavigate,
  onToggleColorScheme,
  onToggleMobileNavigation,
}: AppHeaderProps) {
  return (
    <>
      <Paper className={styles.header} p="sm" radius="xl" shadow="sm" withBorder>
        <Group className={styles.headerInner} justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Paper className={styles.brandMark} p="xs" radius="xl" withBorder>
              <Text fw={900} size="sm">DDEX</Text>
            </Paper>
            <div>
              <Text fw={700}>Decentralized exchange profile</Text>
              <Text c="dimmed" size="sm">
                Wallet, address, and vault controls in one responsive shell
              </Text>
            </div>
          </Group>

          <Group className={styles.desktopNav} gap="xs" wrap="nowrap">
            {navigationItems.map((item) => (
              <UnstyledButton
                className={styles.navButton}
                data-active={currentView === item.value}
                key={item.value}
                onClick={() => onNavigate(item.value)}
              >
                {item.label}
              </UnstyledButton>
            ))}
          </Group>

          <Group className={styles.headerActions} gap="xs" wrap="nowrap">
            <ActionIcon
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={onToggleColorScheme}
              size="lg"
            >
              {isDark ? <IconSunHigh size={18} /> : <IconMoonStars size={18} />}
            </ActionIcon>
            <Avatar color="violet" radius="xl" variant="light">DX</Avatar>
            <div className={styles.mobileOnly}>
              <Burger
                aria-label="Toggle navigation"
                onClick={onToggleMobileNavigation}
                opened={mobileNavigationOpened}
                size="sm"
              />
            </div>
          </Group>
        </Group>
      </Paper>

      <Drawer
        opened={mobileNavigationOpened}
        onClose={onCloseMobileNavigation}
        padding="md"
        position="right"
        title="Navigate DDEX"
      >
        <Stack gap="sm">
          {navigationItems.map((item) => {
            const Icon = item.icon

            return (
              <UnstyledButton
                className={styles.drawerNavButton}
                key={item.value}
                onClick={() => onNavigate(item.value)}
              >
                <Group align="flex-start" gap="sm" wrap="nowrap">
                  <ThemeIcon color="violet" radius="xl" size="lg" variant="light">
                    <Icon size={18} />
                  </ThemeIcon>
                  <div>
                    <Text fw={700}>{item.label}</Text>
                    <Text c="dimmed" size="sm">{item.description}</Text>
                  </div>
                </Group>
              </UnstyledButton>
            )
          })}
        </Stack>
      </Drawer>
    </>
  )
}
