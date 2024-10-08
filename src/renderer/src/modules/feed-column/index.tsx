import { setAppSearchOpen } from "@renderer/atoms/app"
import { getReadonlyRoute } from "@renderer/atoms/route"
import { useGeneralSettingKey } from "@renderer/atoms/settings/general"
import { useUISettingKey } from "@renderer/atoms/settings/ui"
import { useSidebarActiveView } from "@renderer/atoms/sidebar"
import { Logo } from "@renderer/components/icons/logo"
import { ActionButton } from "@renderer/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover"
import { ProfileButton } from "@renderer/components/user-button"
import { HotKeyScopeMap, views } from "@renderer/constants"
import { shortcuts } from "@renderer/constants/shortcuts"
import { useNavigateEntry } from "@renderer/hooks/biz/useNavigateEntry"
import { useReduceMotion } from "@renderer/hooks/biz/useReduceMotion"
import { getRouteParams } from "@renderer/hooks/biz/useRouteParams"
import { useAuthQuery } from "@renderer/hooks/common"
import { nextFrame, stopPropagation } from "@renderer/lib/dom"
import { Routes } from "@renderer/lib/enum"
import { jotaiStore } from "@renderer/lib/jotai"
import { clamp, cn } from "@renderer/lib/utils"
import { Queries } from "@renderer/queries"
import { useSubscriptionStore } from "@renderer/store/subscription"
import { useFeedUnreadStore } from "@renderer/store/unread"
import { useSubscribeElectronEvent } from "@shared/event"
import { useWheel } from "@use-gesture/react"
import type { MotionValue } from "framer-motion"
import { m, useSpring } from "framer-motion"
import { atom, useAtomValue } from "jotai"
import { Lethargy } from "lethargy"
import type { FC, PropsWithChildren } from "react"
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { isHotkeyPressed, useHotkeys } from "react-hotkeys-hook"
import { Link } from "react-router-dom"
import { toast } from "sonner"

import { WindowUnderBlur } from "../../components/ui/background"
import { FeedList } from "./list"

const lethargy = new Lethargy()

const useBackHome = (active: number) => {
  const navigate = useNavigateEntry()

  return useCallback(
    (overvideActive?: number) => {
      navigate({
        feedId: null,
        entryId: null,
        view: overvideActive ?? active,
      })
    },
    [active, navigate],
  )
}

const useUnreadByView = () => {
  useAuthQuery(Queries.subscription.byView())
  const idByView = useSubscriptionStore((state) => state.feedIdByView)
  const totalUnread = useFeedUnreadStore((state) => {
    const unread = {} as Record<number, number>

    for (const view in idByView) {
      unread[view] = idByView[view].reduce(
        (acc: number, feedId: string) => acc + (state.data[feedId] || 0),
        0,
      )
    }
    return unread
  })

  return totalUnread
}

const carouselWidthAtom = atom(256)
export function FeedColumn({ children }: PropsWithChildren) {
  const carouselRef = useRef<HTMLDivElement>(null)

  const [active, setActive_] = useSidebarActiveView()
  const spring = useSpring(0, {
    stiffness: 700,
    damping: 40,
  })
  const navigateBackHome = useBackHome(active)
  const setActive: typeof setActive_ = useCallback(
    (args) => {
      const nextActive = typeof args === "function" ? args(active) : args
      setActive_(args)

      if (getReadonlyRoute().location.pathname.startsWith(Routes.Feeds)) {
        navigateBackHome(nextActive)
      }
    },
    [active, navigateBackHome, spring],
  )

  useLayoutEffect(() => {
    const { view } = getRouteParams()
    if (view !== undefined) {
      setActive_(view)
    }
  }, [setActive_])

  useLayoutEffect(() => {
    const handler = () => {
      spring.jump(-active * jotaiStore.get(carouselWidthAtom))
    }
    const dispose = jotaiStore.sub(carouselWidthAtom, handler)

    spring.set(-active * jotaiStore.get(carouselWidthAtom))
    return () => {
      dispose()
    }
  }, [active, spring])

  useHotkeys(
    shortcuts.feeds.switchBetweenViews.key,
    (e) => {
      e.preventDefault()
      if (isHotkeyPressed("Left")) {
        setActive((i) => {
          if (i === 0) {
            return views.length - 1
          } else {
            return i - 1
          }
        })
      } else {
        setActive((i) => (i + 1) % views.length)
      }
    },
    { scopes: HotKeyScopeMap.Home },
  )

  useWheel(
    ({ event, last, memo: wait = false, direction: [dx], delta: [dex] }) => {
      if (!last) {
        const s = lethargy.check(event)
        if (s) {
          if (!wait && Math.abs(dex) > 20) {
            setActive((i) => clamp(i + dx, 0, views.length - 1))
            return true
          } else {
            return
          }
        } else {
          return false
        }
      } else {
        return false
      }
    },
    {
      target: carouselRef,
    },
  )

  useLayoutEffect(() => {
    const $carousel = carouselRef.current
    if (!$carousel) return

    const handler = () => {
      const width = $carousel.clientWidth
      jotaiStore.set(carouselWidthAtom, width)
    }
    handler()
    new ResizeObserver(handler).observe($carousel)
    return () => {
      new ResizeObserver(handler).disconnect()
    }
  }, [])

  const normalStyle =
    !window.electron || window.electron.process.platform !== "darwin"

  const unreadByView = useUnreadByView()

  const showSidebarUnreadCount = useUISettingKey("sidebarShowUnreadCount")

  useSubscribeElectronEvent("Discover", () => {
    window.router.navigate(Routes.Discover)
  })

  return (
    <WindowUnderBlur
      className="relative flex h-full flex-col space-y-3 rounded-l-[12px] pt-2.5"
      onClick={useCallback(() => navigateBackHome(), [navigateBackHome])}
    >
      <div
        className={cn(
          "ml-5 mr-3 flex items-center",

          normalStyle ? "ml-4 justify-between" : "justify-end",
        )}
      >
        {normalStyle && (
          <LogoContextMenu>
            <div
              className="relative flex items-center gap-1 font-default text-lg font-semibold"
              onClick={(e) => {
                e.stopPropagation()
                navigateBackHome()
              }}
            >
              <Logo className="mr-1 size-6" />

              {APP_NAME}
            </div>
          </LogoContextMenu>
        )}
        <div
          className="relative flex items-center gap-1"
          onClick={stopPropagation}
        >
          <SearchActionButton />

          <Link to="/discover" tabIndex={-1}>
            <ActionButton shortcut="Meta+T" tooltip="Add">
              <i className="i-mgc-add-cute-re size-5 text-theme-vibrancyFg" />
            </ActionButton>
          </Link>
          <ProfileButton method="modal" />
        </div>
      </div>

      <div
        className="flex w-full justify-between px-3 text-xl text-theme-vibrancyFg"
        onClick={stopPropagation}
      >
        {views.map((item, index) => (
          <ActionButton
            key={item.name}
            tooltip={`${item.name}`}
            shortcut={`${index + 1}`}
            className={cn(
              active === index && item.className,
              "flex flex-col items-center gap-1 text-xl",
              ELECTRON ? "hover:!bg-theme-vibrancyBg" : "",
              showSidebarUnreadCount && "h-11",
            )}
            onClick={(e) => {
              setActive(index)
              e.stopPropagation()
            }}
          >
            {item.icon}
            {showSidebarUnreadCount && (
              <div className="text-[0.625rem] font-medium leading-none">
                {unreadByView[index] > 99 ? (
                  <span className="-mr-0.5">99+</span>
                ) : (
                  unreadByView[index]
                )}
              </div>
            )}
          </ActionButton>
        ))}
      </div>
      <div className="relative size-full overflow-hidden" ref={carouselRef}>
        <SwipeWrapper active={active} spring={spring}>
          {views.map((item, index) => (
            <section
              key={item.name}
              className="absolute h-full w-[var(--fo-feed-col-w)] shrink-0 snap-center"
              style={{
                left: `${index * 100}%`,
              }}
            >
              {active === index && (
                <FeedList
                  className="flex size-full flex-col text-sm"
                  view={index}
                />
              )}
            </section>
          ))}
        </SwipeWrapper>
      </div>

      {children}
    </WindowUnderBlur>
  )
}

const SwipeWrapper: Component<{
  active: number
  spring: MotionValue<number>
}> = ({ children, active, spring }) => {
  const reduceMotion = useReduceMotion()

  const carouselWidth = useAtomValue(carouselWidthAtom)
  const containerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const $container = containerRef.current
    if (!$container) return

    const x = -active * carouselWidth
    // NOTE: To fix the misalignment of the browser's layout, use display to re-render it.
    if (x !== $container.getBoundingClientRect().x) {
      $container.style.display = "none"

      nextFrame(() => {
        $container.style.display = ""
      })
    }
  }, [])

  if (reduceMotion) {
    return (
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{
          transform: `translateX(${-active * carouselWidth}px)`,
        }}
      >
        {children}
      </div>
    )
  }
  return (
    <m.div
      ref={containerRef}
      className="absolute inset-0"
      style={{
        x: spring,
      }}
    >
      {children}
    </m.div>
  )
}

const SearchActionButton = () => {
  const canSearch = useGeneralSettingKey("dataPersist")
  if (!canSearch) return null
  return (
    <ActionButton
      shortcut="Meta+K"
      tooltip="Search"
      onClick={() => setAppSearchOpen(true)}
    >
      <i className="i-mgc-search-2-cute-re size-5 text-theme-vibrancyFg" />
    </ActionButton>
  )
}

const LogoContextMenu: FC<PropsWithChildren> = ({ children }) => {
  const [open, setOpen] = useState(false)
  const logoRef = useRef<SVGSVGElement>(null)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        asChild
        onContextMenu={() => {
          setOpen(true)
        }}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent align="start" className="!p-1">
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(logoRef.current?.outerHTML || "")
            setOpen(false)
            toast.success("Copied to clipboard")
          }}
          className={cn(
            "relative flex cursor-default select-none items-center rounded-sm px-1 py-0.5 text-sm outline-none",
            "focus-within:outline-transparent hover:bg-theme-item-hover dark:hover:bg-neutral-800",
            "gap-2 text-foreground/80 [&_svg]:size-3",
          )}
        >
          <Logo ref={logoRef} />
          <span>Copy Logo SVG</span>
        </button>
      </PopoverContent>
    </Popover>
  )
}
