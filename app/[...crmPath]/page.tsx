import CRMApp from "../CRMApp";
import EntraAuthBoundary from "../components/EntraAuthBoundary";

export default function CrmRoute() {
  return <EntraAuthBoundary><CRMApp /></EntraAuthBoundary>;
}
