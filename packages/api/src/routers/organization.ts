import { clearOrganizationVerifiedDomain } from "@crikket/auth/procedures/clear-organization-verified-domain"
import { getOrganizationVerifiedDomain } from "@crikket/auth/procedures/get-organization-verified-domain"
import { setOrganizationVerifiedDomain } from "@crikket/auth/procedures/set-organization-verified-domain"

export const organizationRouter = {
  getVerifiedDomain: getOrganizationVerifiedDomain,
  setVerifiedDomain: setOrganizationVerifiedDomain,
  clearVerifiedDomain: clearOrganizationVerifiedDomain,
}
