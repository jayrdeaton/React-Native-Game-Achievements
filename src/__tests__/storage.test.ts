import { AchievementsStorage } from '../index'

// resolveStorage is internal (only the AchievementsStorage type is public), so these import the
// module directly rather than going through the barrel. Each case re-imports it in isolation,
// since the resolved store is cached at module scope on purpose.
function freshResolveStorage(setup: () => void): (override?: AchievementsStorage) => AchievementsStorage {
  let resolve!: (override?: AchievementsStorage) => AchievementsStorage
  jest.isolateModules(() => {
    setup()
    resolve = require('../storage').resolveStorage
  })
  return resolve
}

const NATIVE_MODULE = '@react-native-async-storage/async-storage'

describe('resolveStorage', () => {
  afterEach(() => {
    jest.resetModules()
  })

  it('returns an explicit override untouched, without touching the native module', () => {
    const override: AchievementsStorage = { getItem: () => Promise.resolve('x'), setItem: () => Promise.resolve(), removeItem: () => Promise.resolve() }
    const resolveStorage = freshResolveStorage(() => {
      jest.doMock(NATIVE_MODULE, () => {
        throw new Error('should never be required when an override is supplied')
      })
    })
    expect(resolveStorage(override)).toBe(override)
  })

  it('resolves the real AsyncStorage default export when it is installed', () => {
    const fake = { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }
    const resolveStorage = freshResolveStorage(() => {
      jest.doMock(NATIVE_MODULE, () => ({ default: fake }))
    })
    expect(resolveStorage()).toBe(fake)
  })

  it('accepts a CommonJS-shaped module with no default export', () => {
    const fake = { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }
    const resolveStorage = freshResolveStorage(() => {
      jest.doMock(NATIVE_MODULE, () => fake)
    })
    expect(resolveStorage()).toBe(fake)
  })

  it('falls back to a no-op store when AsyncStorage is not installed', async () => {
    const resolveStorage = freshResolveStorage(() => {
      jest.doMock(NATIVE_MODULE, () => {
        throw new Error('Cannot find module')
      })
    })
    const store = resolveStorage()
    await expect(store.getItem('anything')).resolves.toBeNull()
    await expect(store.setItem('a', 'b')).resolves.toBeUndefined()
    await expect(store.removeItem('a')).resolves.toBeUndefined()
  })

  it('caches the resolved store across calls', () => {
    const resolveStorage = freshResolveStorage(() => {
      jest.doMock(NATIVE_MODULE, () => {
        throw new Error('Cannot find module')
      })
    })
    expect(resolveStorage()).toBe(resolveStorage())
  })
})
