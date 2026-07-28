import { MARKET_REGIONS, SUPPORTED_MARKETS } from "@/data/markets";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CountrySelectProps {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

export function CountrySelect({ value, onValueChange, disabled }: CountrySelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder="Selecciona un país" />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {MARKET_REGIONS.map((region) => (
          <SelectGroup key={region}>
            <SelectLabel>{region}</SelectLabel>
            {SUPPORTED_MARKETS.filter((market) => market.region === region).map((market) => (
              <SelectItem key={market.countryCode} value={market.countryCode}>
                <span className="flex w-full items-center justify-between gap-4">
                  <span>{market.countryName}</span>
                  <span className="text-xs text-muted-foreground">{market.currencyCode}</span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
