import { redirect } from 'next/navigation'

/** Registration is intentionally disabled: pupils receive credentials from the teacher. */
export default function SignupPage() {
    redirect('/login')
}
