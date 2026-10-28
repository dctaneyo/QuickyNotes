import { useCallback, useEffect, useRef, useState } from 'react'
import { DigitSlots, NumPad } from '../components/NumPad'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../lib/api'

type Mode = 'signin' | 'signup'
type Step = 'id' | 'pin' | 'signup-pin' | 'signup-confirm' | 'issued'

const ID_LENGTH = 8
const PIN_LENGTH = 6

export function AuthScreen() {
  const { signIn, signUp, enterWorkspace } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')
  const [step, setStep] = useState<Step>('id')
  const [userId, setUserId] = useState('')
  const [pin, setPin] = useState('')
  const [firstPin, setFirstPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [retryIn, setRetryIn] = useState(0)
  const [issued, setIssued] = useState<{ userId: string; firstAccount: boolean } | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | null>(null)

  useEffect(() => {
    if (retryIn <= 0) return
    const timer = window.setInterval(() => setRetryIn((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [retryIn])

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
    },
    [],
  )

  const resetFlow = useCallback((nextMode: Mode) => {
    setMode(nextMode)
    setStep(nextMode === 'signin' ? 'id' : 'signup-pin')
    setPin('')
    setFirstPin('')
    setConfirmPin('')
    setError(null)
    setBusy(false)
    setRetryIn(0)
  }, [])

  const describeError = useCallback((caught: unknown) => {
    if (caught instanceof ApiError) {
      if (caught.status === 0) return "Can't reach the server. Check your connection and try again."
      if (caught.retryAfter && caught.retryAfter > 0) setRetryIn(caught.retryAfter)
      if (caught.remaining !== undefined && caught.remaining > 0) {
        return `${caught.message} ${caught.remaining} ${caught.remaining === 1 ? 'try' : 'tries'} left.`
      }
      return caught.message
    }
    return 'Something went wrong. Try again.'
  }, [])

  const submitPin = useCallback(async () => {
    if (pin.length !== PIN_LENGTH || busy) return
    setBusy(true)
    setError(null)
    try {
      await signIn(userId, pin)
    } catch (caught) {
      setError(describeError(caught))
      setPin('')
      setBusy(false)
    }
  }, [pin, busy, signIn, userId, describeError])

  const finishSignup = useCallback(async () => {
    if (confirmPin.length !== PIN_LENGTH || busy) return
    if (!displayName.trim()) {
      setError('Add a display name to continue.')
      setStep('signup-pin')
      return
    }
    if (confirmPin !== firstPin) {
      setError('Those PINs do not match. Try again.')
      setConfirmPin('')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await signUp(firstPin, displayName.trim())
      setIssued({ userId: result.user.userId, firstAccount: result.firstAccount })
      setStep('issued')
    } catch (caught) {
      setError(describeError(caught))
      setPin('')
      setFirstPin('')
      setConfirmPin('')
      setStep('signup-pin')
    } finally {
      setBusy(false)
    }
  }, [confirmPin, firstPin, busy, signUp, displayName, describeError])

  const digitsForStep = step === 'id' || step === 'pin' || step === 'signup-pin' || step === 'signup-confirm'
  const currentValue =
    step === 'id' ? userId : step === 'signup-confirm' ? confirmPin : pin
  const currentMax = step === 'id' ? ID_LENGTH : PIN_LENGTH

  const handleDigit = (digit: string) => {
    setError(null)
    if (step === 'id') {
      setUserId((value) => (value + digit).slice(0, ID_LENGTH))
      return
    }
    if (step === 'pin') {
      setPin((value) => (value + digit).slice(0, PIN_LENGTH))
      return
    }
    if (step === 'signup-pin') {
      setPin((value) => (value + digit).slice(0, PIN_LENGTH))
      return
    }
    if (step === 'signup-confirm') {
      setConfirmPin((value) => (value + digit).slice(0, PIN_LENGTH))
    }
  }

  const handleBackspace = () => {
    setError(null)
    if (step === 'id') setUserId((value) => value.slice(0, -1))
    else if (step === 'pin') setPin((value) => value.slice(0, -1))
    else if (step === 'signup-pin') setPin((value) => value.slice(0, -1))
    else if (step === 'signup-confirm') setConfirmPin((value) => value.slice(0, -1))
  }

  const handleSubmit = () => {
    if (step === 'id') {
      if (userId.length === ID_LENGTH) setStep('pin')
      return
    }
    if (step === 'pin') {
      void submitPin()
      return
    }
    if (step === 'signup-pin') {
      if (pin.length === PIN_LENGTH) {
        if (!displayName.trim()) {
          setError('Add a display name to continue.')
          return
        }
        setFirstPin(pin)
        setStep('signup-confirm')
      }
      return
    }
    if (step === 'signup-confirm') {
      void finishSignup()
    }
  }

  const canSubmit =
    !busy &&
    retryIn === 0 &&
    (step === 'id'
      ? userId.length === ID_LENGTH
      : step === 'signup-confirm'
        ? confirmPin.length === PIN_LENGTH
        : pin.length === PIN_LENGTH)

  const copyId = async () => {
    if (!issued) return
    try {
      await navigator.clipboard.writeText(issued.userId)
      setCopied(true)
      copyTimer.current = window.setTimeout(() => setCopied(false), 2200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="auth">
      <aside className="auth__brand">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            Q
          </span>
          <span className="brand__name">Quicky Notes</span>
        </div>
        <h1 className="auth__headline">
          Catch it now.
          <br />
          Sort it later.
        </h1>
        <p className="auth__lede">
          A shared notebook for the thoughts that arrive mid-sentence. One line in, keep moving, tidy
          up whenever.
        </p>
        <ul className="auth__points">
          <li>
            <span className="auth__point-num">01</span>
            Eight-digit ID, six-digit PIN, no passwords to invent.
          </li>
          <li>
            <span className="auth__point-num">02</span>
            Everything keeps working on a train with no signal.
          </li>
          <li>
            <span className="auth__point-num">03</span>
            Invite someone by their ID and write in the same note.
          </li>
        </ul>
        <div className="auth__slip" aria-hidden="true">
          <span className="auth__slip-date">TODAY · 21:04</span>
          <p>Call the plumber about the radiator</p>
          <span className="auth__slip-tag">home</span>
        </div>
      </aside>

      <main className="auth__panel">
        <div className={`auth__card${step === 'issued' ? ' auth__card--issued' : ''}`}>
          {step === 'issued' && issued ? (
            <div className="issued">
              <p className="eyebrow">Account created</p>
              <h2 className="auth__title">This is your ID</h2>
              <p className="auth__hint">
                It is the only time we show it. Write it down somewhere safe — you need it, plus your
                PIN, to sign in anywhere.
              </p>
              <div className="issued__id" aria-label={`Your ID is ${issued.userId}`}>
                {issued.userId.slice(0, 4)}
                <span className="issued__gap" />
                {issued.userId.slice(4)}
              </div>
              <div className="issued__actions">
                <button type="button" className="btn btn--ghost" onClick={copyId}>
                  {copied ? 'Copied' : 'Copy ID'}
                </button>
                <button type="button" className="btn btn--primary" onClick={enterWorkspace}>
                  Start writing
                </button>
              </div>
              {issued.firstAccount ? (
                <p className="auth__note">
                  You are the first account, so you are this server&apos;s admin. You can change
                  anyone&apos;s ID later in settings.
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <div className="auth__tabs" role="tablist" aria-label="Account">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'signin'}
                  className={`auth__tab${mode === 'signin' ? ' is-active' : ''}`}
                  onClick={() => resetFlow('signin')}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'signup'}
                  className={`auth__tab${mode === 'signup' ? ' is-active' : ''}`}
                  onClick={() => resetFlow('signup')}
                >
                  Create account
                </button>
              </div>

              {step === 'id' ? (
                <div className="auth__step">
                  <p className="eyebrow">Step 1 of 2</p>
                  <h2 className="auth__title">Your eight-digit ID</h2>
                  <p className="auth__hint">The number you saved when you made this account.</p>
                  <DigitSlots value={userId} max={ID_LENGTH} label="User ID" />
                </div>
              ) : null}

              {step === 'pin' ? (
                <div className="auth__step">
                  <p className="eyebrow">Step 2 of 2</p>
                  <h2 className="auth__title">Your six-digit PIN</h2>
                  <div className="auth__identity">
                    <span>{userId.slice(0, 4)}&nbsp;{userId.slice(4)}</span>
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        setStep('id')
                        setPin('')
                        setError(null)
                      }}
                    >
                      Change
                    </button>
                  </div>
                  <DigitSlots value={pin} max={PIN_LENGTH} masked label="PIN" />
                </div>
              ) : null}

              {step === 'signup-pin' ? (
                <div className="auth__step">
                  <p className="eyebrow">Step 1 of 2</p>
                  <h2 className="auth__title">Pick a six-digit PIN</h2>
                  <p className="auth__hint">
                    Six digits you will actually remember. Five wrong tries locks it for five
                    minutes.
                  </p>
                  <label className="field field--name">
                    <span>Your name</span>
                    <input
                      type="text"
                      value={displayName}
                      maxLength={40}
                      placeholder="Dana"
                      required
                      aria-required="true"
                      onChange={(event) => setDisplayName(event.target.value)}
                      autoComplete="nickname"
                    />
                  </label>
                  <DigitSlots value={pin} max={PIN_LENGTH} masked label="New PIN" />
                </div>
              ) : null}

              {step === 'signup-confirm' ? (
                <div className="auth__step">
                  <p className="eyebrow">Step 2 of 2</p>
                  <h2 className="auth__title">Type that PIN again</h2>
                  <p className="auth__hint">Just to be sure it is the one you meant.</p>
                  <DigitSlots value={confirmPin} max={PIN_LENGTH} masked label="Confirm PIN" />
                </div>
              ) : null}

              <div className="auth__error" role="alert" aria-live="polite">
                {retryIn > 0
                  ? `Too many tries. Try again in ${Math.floor(retryIn / 60)}:${String(retryIn % 60).padStart(2, '0')}.`
                  : error}
              </div>

              {digitsForStep ? (
                <div className="numpad-wrap">
                  <NumPad
                    length={currentValue.length}
                    max={currentMax}
                    onDigit={handleDigit}
                    onBackspace={handleBackspace}
                    onSubmit={handleSubmit}
                    canSubmit={canSubmit}
                    disabled={busy || retryIn > 0}
                  />
                  <p className="auth__keyhint">
                    {busy ? 'Checking…' : 'Use the keypad or your keyboard.'}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>
        <p className="auth__foot">
          Quicky Notes · local-first notes · <span className="mono">v0.1</span>
        </p>
      </main>
    </div>
  )
}
